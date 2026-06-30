import { prisma } from '@/lib/prisma';

/**
 * "Amount paid by the user" for a single booking, decomposed into the two
 * funding sources we actually collect money through:
 *
 *   • online  — the Razorpay portion (Payment.amount).
 *   • wallet  — the wallet portion (Payment.metadata.walletDeduction), or the
 *               full price when the booking was paid purely from the wallet.
 *
 * CASH bookings collect nothing through these rails, so they resolve to
 * { wallet: 0, online: 0 } — the platform tracks cash at the counter, not as
 * a Payment/wallet row. Free / super-admin / unpaid-package-session bookings
 * are likewise { 0, 0 }.
 *
 * The same notion works for BOTH regular and package-redemption bookings: a
 * package session's "amount paid at booking" is whatever upgrade/extra charge
 * the user actually paid (the package base was paid at purchase). For a
 * package session with no extra charge this is correctly 0.
 *
 * This is the single source of truth shared by the admin dashboard's Booking
 * Revenue card, the admin bookings list, and the CSV export so all three
 * reconcile to the rupee.
 */

export interface BookingForPaymentSplit {
  id: string;
  /** Booking.price — the charged amount (for a package row this is the
   *  upgrade/extra + kit rental, i.e. exactly what was collected at booking). */
  price: number | null;
  /** Booking.paymentMethod — 'ONLINE' | 'CASH' | 'WALLET' | null. */
  paymentMethod?: string | null;
}

export interface PaymentForSplit {
  /** Online (Razorpay) portion of the whole order, in rupees. */
  amount: number;
  /** Payment.metadata — read for `walletDeduction` (wallet portion of order). */
  metadata: unknown;
  /** Every booking this single payment covered (multi-slot orders). */
  bookingIds: string[];
}

export interface PaymentSplit {
  wallet: number;
  online: number;
}

/**
 * Pure split for ONE booking, given its linked CAPTURED payment (if any) and a
 * map of price-per-booking used to pro-rate a multi-booking order. No DB access.
 */
export function computeBookingPaymentSplit(
  booking: BookingForPaymentSplit,
  payment: PaymentForSplit | undefined,
  priceByBookingId: Map<string, number>,
): PaymentSplit {
  // A captured payment is the authoritative record — it captures mixed
  // wallet+online payments exactly. Pro-rate across every booking in the
  // order so the per-row numbers always sum back to the captured payment.
  if (payment) {
    const orderTotal = payment.bookingIds.reduce(
      (sum, bId) => sum + (priceByBookingId.get(bId) ?? 0),
      0,
    );
    const meta = (payment.metadata as Record<string, unknown> | null) ?? null;
    const walletPortion = typeof meta?.walletDeduction === 'number' ? meta.walletDeduction : 0;
    const onlinePortion = payment.amount;
    const myPrice = booking.price ?? 0;
    if (orderTotal > 0) {
      return {
        wallet: Math.round((myPrice / orderTotal) * walletPortion),
        online: Math.round((myPrice / orderTotal) * onlinePortion),
      };
    }
    return { wallet: walletPortion, online: onlinePortion };
  }

  // No captured payment row — fall back to the booking's recorded method.
  // A pure WALLET booking never has a Razorpay Payment; a legacy/unlinked
  // ONLINE booking is approximated by its full price.
  if (booking.paymentMethod === 'WALLET') {
    return { wallet: booking.price ?? 0, online: 0 };
  }
  if (booking.paymentMethod === 'ONLINE') {
    return { wallet: 0, online: booking.price ?? 0 };
  }
  // CASH / null / package session with no extra → nothing collected digitally.
  return { wallet: 0, online: 0 };
}

/**
 * DB-aware: resolve the { wallet, online } split for a set of bookings.
 *
 * Loads the CAPTURED payments referencing these bookings, back-fills the price
 * of any sibling bookings those payments also covered but that fall outside the
 * provided set (so multi-booking-order pro-rating stays correct), then returns
 * a Map keyed by booking id. Bookings with no captured payment fall back to
 * their recorded paymentMethod.
 */
export async function getBookingPaymentSplits(
  bookings: BookingForPaymentSplit[],
): Promise<Map<string, PaymentSplit>> {
  const result = new Map<string, PaymentSplit>();
  if (bookings.length === 0) return result;

  const bookingIds = bookings.map((b) => b.id);
  const payments = await prisma.payment.findMany({
    where: { status: 'CAPTURED', bookingIds: { hasSome: bookingIds } },
    select: { id: true, amount: true, metadata: true, bookingIds: true },
  });

  const priceByBookingId = new Map<string, number>(
    bookings.map((b) => [b.id, b.price ?? 0]),
  );

  // Back-fill sibling prices referenced by these payments but absent from the
  // provided set, else `orderTotal` would be undercounted and the per-row
  // amounts would inflate toward the full order total.
  const referenced = new Set<string>();
  for (const p of payments) for (const bId of p.bookingIds) referenced.add(bId);
  const missing = [...referenced].filter((id) => !priceByBookingId.has(id));
  if (missing.length > 0) {
    const siblings = await prisma.booking.findMany({
      where: { id: { in: missing } },
      select: { id: true, price: true },
    });
    for (const s of siblings) priceByBookingId.set(s.id, s.price ?? 0);
  }

  const paymentByBookingId = new Map<string, PaymentForSplit>();
  for (const p of payments) for (const bId of p.bookingIds) paymentByBookingId.set(bId, p);

  for (const b of bookings) {
    result.set(
      b.id,
      computeBookingPaymentSplit(b, paymentByBookingId.get(b.id), priceByBookingId),
    );
  }
  return result;
}

/**
 * Human-readable payment-method label derived from a booking's actual money
 * split (not its raw enum). Used by the CSV export and admin list so a mixed
 * wallet+online payment, or an online-paid package upgrade, reads correctly
 * instead of a bare enum or a misleading "NA".
 */
export function paymentMethodLabel(
  split: PaymentSplit,
  booking: { paymentMethod?: string | null; isPackage?: boolean },
): string {
  if (split.wallet > 0 && split.online > 0) return 'Wallet + Online';
  if (split.wallet > 0) return 'Wallet';
  if (split.online > 0) return 'Online';
  if (booking.paymentMethod === 'CASH') return 'Cash';
  // Nothing collected at booking time: a package session (paid at purchase)
  // or a free booking. 'NA' matches the export's long-standing convention.
  return 'NA';
}
