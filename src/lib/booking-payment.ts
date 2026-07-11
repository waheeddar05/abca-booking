import { prisma } from '@/lib/prisma';
import type { PaymentStatus } from '@prisma/client';

/**
 * "Amount paid by the user" for a booking — the single source of truth shared
 * by the admin dashboard Booking Revenue card, the admin bookings list, and the
 * CSV export so all three reconcile.
 *
 * DESIGN: the captured Payment row is the authoritative record of what was
 * collected. `Payment.amount` is the online (Razorpay) charge for the WHOLE
 * order and `Payment.metadata.walletDeduction` is the wallet portion of that
 * order; both are split EVENLY across the order's bookings
 * (Payment.bookingIds), so per-row figures always sum back to the money that
 * actually moved.
 *
 * We deliberately do NOT derive amounts from `Booking.price`: reconciling the
 * export against real payment data showed per-slot prices drifting from what
 * was collected (consecutive-slot discounts and the legacy cancellation
 * re-pricing both mutate `price` around the payment), so a price-based figure
 * over- or under-reports. Price-weighted pro-rating has the same problem —
 * the weights themselves drift — which is why the split is even.
 *
 * The wallet ledger (WalletTransaction DEBIT_BOOKING) is only a FALLBACK for
 * legacy payments that never recorded `walletDeduction`: a ledger debit can
 * reference a booking whose order was later re-paid without the wallet, so
 * when the payment carries a recorded walletDeduction (including 0) it wins.
 *
 * Cash is excluded (digital-only, per product decision); free / pay-later /
 * package-covered bookings collect nothing through these rails and resolve
 * to 0.
 */

export interface BookingForSplit {
  id: string;
  /** Booking.price — used only as a fallback when no captured Payment exists
   *  (pure-wallet orders and legacy/unlinked online rows). */
  price?: number | null;
  /** Booking.paymentMethod — 'ONLINE' | 'WALLET' | 'CASH' | null. */
  paymentMethod?: string | null;
}

export interface RefundLite {
  amount: number;
  status: string;
}

export interface PaymentSplit {
  wallet: number;
  online: number;
}

export const EMPTY_SPLIT: PaymentSplit = { wallet: 0, online: 0 };

/**
 * Payment statuses that represent money actually captured from the customer.
 * Every refund flow flips CAPTURED → PARTIALLY_REFUNDED / REFUNDED while
 * leaving Payment.amount at the captured gross (refunds accrue separately in
 * Refund rows / refundAmount). Those payments must stay visible here —
 * filtering to CAPTURED alone would make a single refunded slot silently
 * revert its whole order (including active siblings) to the price-based
 * numbers. Refunds are netted separately via splitAmountNet / the CSV
 * Refund columns.
 */
const COLLECTED_PAYMENT_STATUSES: PaymentStatus[] = ['CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED'];

/**
 * Prisma "table/column does not exist" codes — the only failures the money
 * helpers may absorb (some environments run before the Payment /
 * WalletTransaction migrations). Anything else rethrows so a transient DB
 * error fails the request loudly instead of serving price-based numbers
 * disguised as payment-derived ones.
 */
function isMissingDbObjectError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === 'P2021' || code === 'P2022';
}

/** This booking's even share of one captured payment. */
export interface CapturedPaymentShare {
  /** Payment.amount — online (Razorpay) rupees for the whole order. */
  amount: number;
  /** Payment.metadata.walletDeduction — wallet rupees for the whole order.
   *  null when the metadata never recorded it (legacy rows). */
  walletDeduction: number | null;
  /** How many bookings the payment covered (Payment.bookingIds.length). */
  bookingCount: number;
}

/**
 * Pure split for ONE booking. No DB access.
 *
 *   - Captured payment(s) exist → even per-slot share of the order's online
 *     amount and recorded wallet deduction. When none of the payments recorded
 *     a walletDeduction (legacy), the wallet ledger share fills in.
 *   - No payment, WALLET booking  → its price, all wallet (pure-wallet orders
 *     never create a Payment row).
 *   - No payment, ONLINE booking  → legacy/unlinked: approximated by its price,
 *     with any ledger-attributed wallet carved out of it.
 *   - Cash / free / package-covered → 0 / 0.
 */
export function computeBookingPaymentSplit(
  b: { price?: number | null; paymentMethod?: string | null },
  payments: CapturedPaymentShare[],
  ledgerWalletShare: number,
): PaymentSplit {
  if (payments.length > 0) {
    let online = 0;
    let wallet = 0;
    let hasRecordedWallet = false;
    for (const p of payments) {
      const n = Math.max(1, p.bookingCount);
      online += Math.round(p.amount / n);
      if (typeof p.walletDeduction === 'number') {
        hasRecordedWallet = true;
        wallet += Math.round(p.walletDeduction / n);
      }
    }
    if (!hasRecordedWallet) wallet = Math.max(0, ledgerWalletShare);
    return { wallet, online };
  }

  const price = b.price ?? 0;
  if (b.paymentMethod === 'WALLET') {
    return { wallet: price, online: 0 };
  }
  if (b.paymentMethod === 'ONLINE') {
    const wallet = Math.min(Math.max(0, ledgerWalletShare), price);
    return { wallet, online: price - wallet };
  }
  return { wallet: 0, online: 0 };
}

/** Gross rupees collected for the booking (wallet + online). */
export function splitAmountGross(split: PaymentSplit): number {
  return split.wallet + split.online;
}

/**
 * Gross collected, net of the booking's non-failed refunds. Clamped at 0:
 * refund rows are sized from the (mutable) per-slot price, which can exceed
 * this booking's even share of its order — a cancelled slot then reads ₹0
 * collected rather than a negative amount.
 */
export function splitAmountNet(split: PaymentSplit, refunds: RefundLite[] = []): number {
  let v = splitAmountGross(split);
  for (const r of refunds) {
    if (r.status !== 'FAILED') v -= r.amount;
  }
  return Math.max(0, v);
}

/**
 * Wallet rupees attributed to each booking, read from the wallet ledger
 * (WalletTransaction type=DEBIT_BOOKING). Fallback source only — see the
 * module doc for why the payment's recorded walletDeduction wins when present.
 *
 * A multi-slot order debits the wallet ONCE, referencing the first booking of
 * the order. We therefore look up that order's slots via Payment.bookingIds and
 * split the debit EVENLY across them, so each slot of the order shows its share
 * of the wallet rather than the whole amount landing on the first slot. The
 * per-order total is preserved exactly; single-slot orders are unaffected.
 *
 * `orderGroups` lets a caller that already fetched the relevant payments skip
 * the extra Payment lookup used to resolve each debit's order.
 */
export async function getBookingWalletShares(
  bookingIds: string[],
  orderGroups?: Array<{ bookingIds: string[] }>,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (bookingIds.length === 0) return out;

  let debits: Array<{ referenceId: string | null; amount: number }>;
  try {
    debits = await prisma.walletTransaction.findMany({
      where: { type: 'DEBIT_BOOKING', referenceId: { in: bookingIds } },
      select: { referenceId: true, amount: true },
    });
  } catch (err) {
    if (isMissingDbObjectError(err)) return out;
    throw err;
  }
  if (debits.length === 0) return out;

  // Resolve the order each debit belongs to (the Payment whose bookingIds
  // contains the referenced booking) so a multi-slot order's wallet is spread
  // across its slots instead of concentrated on the first one.
  const refIds = debits.map((d) => d.referenceId).filter((id): id is string => !!id);
  let groups = orderGroups;
  if (!groups) {
    groups = refIds.length > 0
      ? await prisma.payment.findMany({
          where: { bookingIds: { hasSome: refIds } },
          select: { bookingIds: true },
        })
      : [];
  }
  const groupByBookingId = new Map<string, string[]>();
  for (const g of groups) {
    for (const bId of g.bookingIds) {
      if (!groupByBookingId.has(bId)) groupByBookingId.set(bId, g.bookingIds);
    }
  }

  for (const d of debits) {
    if (!d.referenceId) continue;
    const group = groupByBookingId.get(d.referenceId);
    if (group && group.length > 1) {
      // Even split, rounded; the small rounding remainder is harmless for a
      // display column.
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

/**
 * DB-aware: resolve the { wallet, online } split for a set of bookings in at
 * most two batch queries (captured payments + wallet-ledger fallback for the
 * rows that actually need it). Returns a Map keyed by booking id; every input
 * booking gets an entry.
 */
export async function getBookingPaymentSplits(
  bookings: BookingForSplit[],
): Promise<Map<string, PaymentSplit>> {
  const result = new Map<string, PaymentSplit>();
  if (bookings.length === 0) return result;

  const bookingIds = bookings.map((b) => b.id);

  let payments: Array<{ amount: number; metadata: unknown; bookingIds: string[] }> = [];
  try {
    payments = await prisma.payment.findMany({
      where: {
        status: { in: COLLECTED_PAYMENT_STATUSES },
        bookingIds: { hasSome: bookingIds },
      },
      select: { amount: true, metadata: true, bookingIds: true },
    });
  } catch (err) {
    if (!isMissingDbObjectError(err)) throw err;
    // Payment table not migrated in this environment — every row falls back
    // to its method-based approximation below.
    console.error('[booking-payment] Payment table unavailable, using price-based fallback:', err);
  }

  const sharesByBookingId = new Map<string, CapturedPaymentShare[]>();
  for (const p of payments) {
    const meta = (p.metadata as Record<string, unknown> | null) ?? null;
    const share: CapturedPaymentShare = {
      amount: p.amount,
      walletDeduction:
        typeof meta?.walletDeduction === 'number' ? (meta.walletDeduction as number) : null,
      bookingCount: p.bookingIds.length,
    };
    for (const bId of p.bookingIds) {
      const list = sharesByBookingId.get(bId);
      if (list) list.push(share);
      else sharesByBookingId.set(bId, [share]);
    }
  }

  // The wallet ledger is only consulted for bookings that need it: rows with
  // no captured payment (the ONLINE price fallback carves ledger wallet out)
  // and rows whose payment(s) predate walletDeduction metadata.
  const needsLedger = (b: BookingForSplit): boolean => {
    const shares = sharesByBookingId.get(b.id);
    if (!shares || shares.length === 0) return b.paymentMethod === 'ONLINE';
    return shares.every((s) => s.walletDeduction === null);
  };
  const needy = bookings.filter(needsLedger);

  let ledgerShares = new Map<string, number>();
  if (needy.length > 0) {
    // A multi-slot order's single wallet debit references the order's FIRST
    // booking, which may fall outside this page/filter window — include every
    // sibling id from legacy payments so the debit is found regardless of
    // which of the order's slots the caller happened to query.
    const ledgerIds = new Set<string>(needy.map((b) => b.id));
    for (const p of payments) {
      const meta = (p.metadata as Record<string, unknown> | null) ?? null;
      if (typeof meta?.walletDeduction !== 'number') {
        for (const bId of p.bookingIds) ledgerIds.add(bId);
      }
    }
    ledgerShares = await getBookingWalletShares(Array.from(ledgerIds), payments);
  }

  for (const b of bookings) {
    result.set(
      b.id,
      computeBookingPaymentSplit(
        b,
        sharesByBookingId.get(b.id) ?? [],
        ledgerShares.get(b.id) ?? 0,
      ),
    );
  }
  return result;
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
