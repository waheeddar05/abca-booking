import { prisma } from '@/lib/prisma';

/**
 * "Amount paid by the user" for a booking — the single source of truth shared
 * by the admin dashboard Booking Revenue card, the admin bookings list, and the
 * CSV export so all three reconcile.
 *
 * DESIGN: we use each booking's OWN price (what was charged for that slot), not
 * a share of the order's Razorpay payment. Pro-rating a shared multi-slot
 * payment by price is unreliable: consecutive-slot discounts and the
 * cancellation re-pricing both MUTATE the per-slot price after payment, so the
 * shares drift (a cancelled+refunded slot ended up showing the whole order
 * total, partial-wallet slots showed odd fractions). For an online/wallet
 * booking the price IS exactly what was collected (online + wallet), so basing
 * the figure on price is both exact and refund-stable.
 *
 * Cash is excluded (digital-only, per product decision); free / pay-later /
 * package-covered bookings collect nothing through these rails and resolve to 0.
 */

export interface BookingForAmount {
  /** Booking.price — charged amount for this slot (already includes any
   *  consecutive discount, promo, and kit rental). */
  price?: number | null;
  /** Booking.paymentMethod — 'ONLINE' | 'WALLET' | 'CASH' | null. */
  paymentMethod?: string | null;
}

export interface RefundLite {
  amount: number;
  status: string;
}

/**
 * Gross amount collected for a booking through trackable rails (online +
 * wallet). 0 for cash / free / pay-later / package-covered bookings.
 */
export function bookingAmountPaidGross(b: BookingForAmount): number {
  if (b.paymentMethod === 'ONLINE' || b.paymentMethod === 'WALLET') {
    return b.price ?? 0;
  }
  return 0;
}

/** Gross amount paid, net of this booking's non-failed refunds. */
export function bookingAmountPaidNet(b: BookingForAmount, refunds: RefundLite[] = []): number {
  let v = bookingAmountPaidGross(b);
  for (const r of refunds) {
    if (r.status !== 'FAILED') v -= r.amount;
  }
  return v;
}

/**
 * Wallet rupees attributed to each booking, read from the wallet ledger
 * (WalletTransaction type=DEBIT_BOOKING). This is the authoritative record of
 * wallet spend and fixes the case where a partial wallet payment showed ₹0
 * because Payment.metadata.walletDeduction was absent.
 *
 * A multi-slot order debits the wallet ONCE, referencing the first booking of
 * the order. We therefore look up that order's slots via Payment.bookingIds and
 * split the debit EVENLY across them, so each slot of the order shows its share
 * of the wallet rather than the whole amount landing on the first slot. The
 * per-order total is preserved exactly; single-slot orders are unaffected.
 */
export async function getBookingWalletShares(bookingIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (bookingIds.length === 0) return out;

  const debits = await prisma.walletTransaction.findMany({
    where: { type: 'DEBIT_BOOKING', referenceId: { in: bookingIds } },
    select: { referenceId: true, amount: true },
  });
  if (debits.length === 0) return out;

  // Resolve the order each debit belongs to (the Payment whose bookingIds
  // contains the referenced booking) so a multi-slot order's wallet is spread
  // across its slots instead of concentrated on the first one.
  const refIds = debits.map((d) => d.referenceId).filter((id): id is string => !!id);
  const payments = refIds.length > 0
    ? await prisma.payment.findMany({
        where: { bookingIds: { hasSome: refIds } },
        select: { bookingIds: true },
      })
    : [];

  for (const d of debits) {
    if (!d.referenceId) continue;
    const group = payments.find((p) => p.bookingIds.includes(d.referenceId!))?.bookingIds;
    if (group && group.length > 1) {
      // Even split, rounded; the small rounding remainder is harmless for a
      // display column (online is derived as amount − wallet per slot).
      const share = Math.round(d.amount / group.length);
      for (const bId of group) out.set(bId, (out.get(bId) ?? 0) + share);
    } else {
      // Single-slot order (or no Payment grouping, e.g. wallet-only): the whole
      // debit stays on the referenced booking.
      out.set(d.referenceId, (out.get(d.referenceId) ?? 0) + d.amount);
    }
  }
  return out;
}

export interface PaymentSplit {
  wallet: number;
  online: number;
}

/**
 * Gross wallet/online split for ONE booking (used by the CSV export). The
 * split always sums to bookingAmountPaidGross(b):
 *   - WALLET booking            → all wallet.
 *   - ONLINE booking            → wallet from the ledger (capped at the amount),
 *                                 remainder is online.
 *   - cash / free / package-covered → 0 / 0.
 */
export function bookingPaymentSplit(b: BookingForAmount, walletDebit: number): PaymentSplit {
  const amount = bookingAmountPaidGross(b);
  if (amount <= 0) return { wallet: 0, online: 0 };
  if (b.paymentMethod === 'WALLET') return { wallet: amount, online: 0 };
  // ONLINE (possibly part-wallet): wallet portion from the ledger, capped so
  // wallet + online never exceeds what was charged for this slot.
  const wallet = Math.min(Math.max(0, walletDebit), amount);
  return { wallet, online: amount - wallet };
}

/**
 * Human-readable payment-method label derived from the actual money split, so a
 * mixed payment reads "Wallet + Online" and an online-paid package upgrade reads
 * "Online" instead of a bare enum or a misleading "NA".
 */
export function paymentMethodLabel(
  split: PaymentSplit,
  b: { paymentMethod?: string | null; isPackage?: boolean },
): string {
  if (split.wallet > 0 && split.online > 0) return 'Wallet + Online';
  if (split.wallet > 0) return 'Wallet';
  if (split.online > 0) return 'Online';
  if (b.paymentMethod === 'CASH') return 'Cash';
  // Nothing collected through online/wallet: a package session (paid at
  // purchase), a free booking, or a pay-later/cash row with no online amount.
  return 'NA';
}
