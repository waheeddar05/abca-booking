/**
 * Booking cancellation refunds.
 *
 * POLICY: each cancelled slot is refunded the price that slot was actually
 * charged — an even, per-slot refund.
 *
 * We deliberately DO NOT re-price the remaining consecutive siblings to claw
 * back the multi-slot discount on cancellation. That older behaviour produced
 * uneven, confusing refunds (e.g. ₹0 on the first cancelled slot of a chain and
 * the whole amount on the next) and is what made a multi-slot cancellation look
 * wrong. With it removed, `processCancellationRefund` simply refunds
 * `booking.price` for each cancelled slot, so two cancellations of equally
 * priced slots refund the same amount.
 *
 * Trade-off (intentional, product decision): a customer who cancels part of a
 * consecutive booking keeps the multi-slot discounted rate on the slots they
 * retain, instead of being re-charged the single-slot rate.
 */

import { prisma } from '@/lib/prisma';
import type { Booking } from '@prisma/client';
import { creditWallet, getDefaultRefundMethod, isWalletEnabled } from '@/lib/wallet';
import { notifyWalletCredit } from '@/lib/notifications';

/**
 * No-op retained for call-site compatibility (user cancel, admin cancel, slot
 * block, availability sync all call this). It used to re-price the cancelled
 * booking's consecutive siblings and claw the discount back from the refund;
 * that is disabled so every cancelled slot refunds its own charged price.
 * Always returns 0 and never mutates any price.
 */
export function adjustSiblingPricesForCancellation(
  booking: Booking,
): Promise<number> {
  void booking; // retained for call-site compatibility; intentionally unused
  return Promise.resolve(0);
}

// ─── Shared cancellation refund ──────────────────────────────────────
//
// `processCancellationRefund` consolidates the wallet/Razorpay refund
// logic that used to be duplicated (~150 lines each) inside
// /api/slots/cancel (user cancel) and /api/admin/bookings PATCH
// (admin cancel). Both routes now call this in a single line; the
// helper handles every flavour:
//
//   - Wallet-paid booking → credit the unrefunded remainder back to
//     wallet, mark booking UNPAID, create Refund row, notify user.
//   - Online-paid booking + wallet refund method (default) → credit
//     wallet, update Payment.refundAmount, mark
//     REFUNDED/PARTIALLY_REFUNDED, create Refund row, notify user.
//   - Online-paid booking + Razorpay refund method → call
//     `initiateRefund` against the originating center's account,
//     update Payment as above, create Refund row (status=INITIATED).
//
// `requestedRefundMethod` lets the user/admin override the
// center-configured default (`DEFAULT_REFUND_METHOD` policy).
//
// Returns null when there's nothing to refund (already fully
// refunded, no payment row, or booking has no price).

export interface CancellationRefundResult {
  method: 'WALLET' | 'RAZORPAY';
  amount: number;
  refundId?: string;
  walletTransactionId?: string;
  newBalance?: number;
}

export async function processCancellationRefund(opts: {
  booking: Booking;
  initiatedByUserId: string;
  initiatedByName: string;
  requestedRefundMethod?: 'WALLET' | 'RAZORPAY';
}): Promise<CancellationRefundResult | null> {
  const { booking, initiatedByUserId, initiatedByName, requestedRefundMethod } = opts;

  // Diagnostic prefix kept consistent across every early-return below so
  // support investigations can grep `[Refund]` and see exactly why a
  // booking didn't get a wallet credit (the most common production
  // mystery — silent no-op).
  const tag = `[Refund booking=${booking.id} center=${booking.centerId}]`;

  if (!booking.userId) {
    console.warn(`${tag} skipped: booking has no userId (anonymous booking)`);
    return null;
  }
  if (!booking.price || booking.price <= 0) {
    console.warn(`${tag} skipped: booking.price=${booking.price ?? 'null'} (free or zero-priced)`);
    return null;
  }

  // Sum of refunds already issued on this booking (avoids double-refund
  // when the user cancels again after a partial refund, or when an
  // admin force-cancels a row that already had a manual refund).
  const existingRefunds = await prisma.refund.findMany({
    where: { bookingId: booking.id, status: { not: 'FAILED' } },
    select: { amount: true },
  });
  const alreadyRefunded = existingRefunds.reduce((sum, r) => sum + r.amount, 0);

  console.log(
    `${tag} start: paymentMethod=${booking.paymentMethod ?? 'null'} paymentStatus=${booking.paymentStatus ?? 'null'} price=${booking.price} alreadyRefunded=${alreadyRefunded}`,
  );

  // ─── Case 1: Wallet-paid booking ─────────────────────────────────
  if (booking.paymentMethod === 'WALLET' && booking.paymentStatus === 'PAID') {
    // Refund the slot's own charged price (no consecutive clawback), minus
    // anything already refunded on this booking.
    const remaining = booking.price - alreadyRefunded;
    if (remaining <= 0) {
      // Already fully refunded — just flip the booking flag so the UI
      // matches reality.
      await prisma.booking.update({
        where: { id: booking.id },
        data: { paymentStatus: 'UNPAID' },
      });
      return null;
    }

    const walletResult = await creditWallet(
      booking.userId,
      booking.centerId,
      remaining,
      'CREDIT_REFUND',
      `Refund for cancelled booking`,
      booking.id,
    );

    await prisma.booking.update({
      where: { id: booking.id },
      data: { paymentStatus: 'UNPAID' },
    });

    await prisma.refund.create({
      data: {
        bookingId: booking.id,
        amount: remaining,
        method: 'WALLET',
        status: 'PROCESSED',
        reason: `Auto-refund: booking cancelled by ${initiatedByName}`,
        walletTransactionId: walletResult.transactionId,
        initiatedById: initiatedByUserId,
      },
    });

    await safelyNotifyWalletCredit(booking.userId, remaining, walletResult.newBalance, booking.centerId, booking.id);

    return {
      method: 'WALLET',
      amount: remaining,
      walletTransactionId: walletResult.transactionId,
      newBalance: walletResult.newBalance,
    };
  }

  // ─── Case 2: Online-paid booking ─────────────────────────────────
  if (booking.paymentMethod !== 'ONLINE' || booking.paymentStatus !== 'PAID') {
    // FREE booking, CASH booking, or package redemption — nothing to
    // refund automatically.
    console.log(
      `${tag} skipped: paymentMethod=${booking.paymentMethod ?? 'null'} paymentStatus=${booking.paymentStatus ?? 'null'} — not a refundable case`,
    );
    return null;
  }

  // CRITICAL: include PARTIALLY_REFUNDED in the status filter. A
  // common multi-slot scenario is "user cancels slot 1 (Payment flips
  // to PARTIALLY_REFUNDED), then admin cancels slot 2" — if the
  // filter was `CAPTURED` only, the second cancellation would skip
  // refund silently. This was a real prod incident; the test for it
  // is captured in this comment so it doesn't regress.
  const payment = await prisma.payment.findFirst({
    where: {
      bookingIds: { has: booking.id },
      status: { in: ['CAPTURED', 'PARTIALLY_REFUNDED'] },
    },
  });
  if (!payment) {
    console.warn(
      `${tag} skipped: no Payment row with status CAPTURED|PARTIALLY_REFUNDED containing this bookingId. Booking marked online-paid but no live payment found — manual review needed.`,
    );
    return null;
  }
  if (!payment.razorpayPaymentId) {
    console.warn(
      `${tag} skipped: Payment ${payment.id} has no razorpayPaymentId — cannot refund. Likely captured via webhook with missing payment id.`,
    );
    return null;
  }

  // Per-slot refund = booking.price (handles consecutive discounts and
  // mixed prices on a multi-slot payment). Fall back to an even split
  // only when booking.price is missing.
  const perSlotRefund = booking.price > 0
    ? booking.price
    : (payment.bookingIds.length > 1
        ? payment.amount / payment.bookingIds.length
        : payment.amount);
  const remaining = perSlotRefund - alreadyRefunded;
  if (remaining <= 0) {
    console.log(
      `${tag} skipped: nothing left to refund (perSlot=${perSlotRefund}, alreadyRefunded=${alreadyRefunded})`,
    );
    return null;
  }

  // Resolve refund method:
  //   1. Explicit request from user/admin.
  //   2. Center-configured default (DEFAULT_REFUND_METHOD policy).
  //   3. WALLET when enabled, else RAZORPAY.
  const walletEnabled = await isWalletEnabled(booking.centerId);
  let method: 'WALLET' | 'RAZORPAY';
  if (requestedRefundMethod === 'WALLET' || requestedRefundMethod === 'RAZORPAY') {
    method = requestedRefundMethod;
    if (method === 'WALLET' && !walletEnabled) method = 'RAZORPAY';
  } else {
    method = walletEnabled ? await getDefaultRefundMethod(booking.centerId) : 'RAZORPAY';
  }

  const totalRefundedOnPayment = (payment.refundAmount || 0) + remaining;
  const isFullPaymentRefund = totalRefundedOnPayment >= payment.amount;

  if (method === 'WALLET') {
    const walletResult = await creditWallet(
      booking.userId,
      booking.centerId,
      remaining,
      'CREDIT_REFUND',
      `Refund for cancelled booking`,
      booking.id,
    );

    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: isFullPaymentRefund ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
        refundAmount: { increment: remaining },
        refundedAt: new Date(),
        refundMethod: 'WALLET',
      },
    });

    await prisma.refund.create({
      data: {
        bookingId: booking.id,
        paymentId: payment.id,
        amount: remaining,
        method: 'WALLET',
        status: 'PROCESSED',
        reason: `Auto-refund: booking cancelled by ${initiatedByName}`,
        walletTransactionId: walletResult.transactionId,
        initiatedById: initiatedByUserId,
      },
    });

    await safelyNotifyWalletCredit(booking.userId, remaining, walletResult.newBalance, booking.centerId, booking.id);

    return {
      method: 'WALLET',
      amount: remaining,
      walletTransactionId: walletResult.transactionId,
      newBalance: walletResult.newBalance,
    };
  }

  // method === 'RAZORPAY'. Dynamic import avoids pulling the SDK on
  // routes that never refund.
  const { initiateRefund } = await import('@/lib/razorpay');
  const refund = await initiateRefund({
    centerId: booking.centerId,
    paymentId: payment.razorpayPaymentId,
    amount: remaining,
    notes: { bookingId: booking.id, cancelledBy: initiatedByName },
  });

  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: isFullPaymentRefund ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
      refundId: refund.id,
      refundAmount: { increment: remaining },
      refundedAt: new Date(),
      refundMethod: 'RAZORPAY',
    },
  });

  await prisma.refund.create({
    data: {
      bookingId: booking.id,
      paymentId: payment.id,
      amount: remaining,
      method: 'RAZORPAY',
      status: 'INITIATED',
      reason: `Auto-refund: booking cancelled by ${initiatedByName}`,
      razorpayRefundId: refund.id,
      initiatedById: initiatedByUserId,
    },
  });

  return {
    method: 'RAZORPAY',
    amount: remaining,
    refundId: refund.id,
  };
}

/**
 * Wallet-credit notification — best-effort, never throws. Lives here
 * so the caller doesn't have to wrap each refund branch in its own
 * try/catch.
 */
async function safelyNotifyWalletCredit(
  userId: string,
  amount: number,
  newBalance: number,
  centerId: string,
  bookingId?: string | null,
): Promise<void> {
  try {
    const notifUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { mobileNumber: true, mobileVerified: true },
    });
    await notifyWalletCredit(userId, {
      amount,
      reason: 'Booking cancellation refund',
      newBalance,
      mobileNumber: notifUser?.mobileVerified ? notifUser.mobileNumber : null,
      centerId,
      bookingId: bookingId ?? null,
    });
  } catch (err) {
    console.warn('[BookingCancel] Wallet credit notification failed:', err);
  }
}
