/**
 * Booking cancellation — consecutive-discount-aware sibling repricing.
 *
 * When a booking that was part of a consecutive chain is cancelled, the
 * remaining siblings are no longer in that chain (or are in a smaller
 * chain) and lose their per-slot consecutive discount. The user's refund
 * is reduced by the price increase on those siblings, so the user
 * effectively pays the single-slot price for each remaining slot.
 *
 * Example with ABCA single=₹500 / 2-consecutive=₹900 (₹450/slot):
 *   User books 2 consecutive slots → paid ₹900 (each booking row = ₹450).
 *   User cancels slot #1:
 *     - Sibling slot #2 is re-priced ₹450 → ₹500 (+₹50 increase).
 *     - consecutiveAdjustment = ₹50.
 *     - Refund = cancelled.price - adjustment = ₹450 - ₹50 = ₹400.
 *     - Sibling now reflects ₹500 on the booking row.
 *   User then cancels slot #2:
 *     - No remaining siblings → no adjustment.
 *     - Refund = ₹500 (the repriced amount).
 *
 * Total refunded = ₹900 = original total. Correct.
 *
 * Both ABCA (MACHINE_PITCH, legacy `machineId` enum) and Toplay
 * (RESOURCE_BASED, `assignedMachineId` FK) are supported.
 */

import { prisma } from '@/lib/prisma';
import type { Booking } from '@prisma/client';
import {
  calculateNewPricing,
  getPricingConfig,
  getTimeSlabConfig,
} from '@/lib/pricing';
import {
  getBallTypeForMachine,
  MACHINE_A_BALLS,
} from '@/lib/constants';
import type { MachineId } from '@prisma/client';
import { getResourceSlotPrice, getResourcePricingConfig } from '@/lib/resource-pricing';
import { creditWallet, getDefaultRefundMethod, isWalletEnabled } from '@/lib/wallet';
import { notifyWalletCredit } from '@/lib/notifications';

/**
 * Re-prices the cancelled booking's BOOKED siblings and writes the
 * higher price back onto each sibling row. Returns the total
 * `consecutiveAdjustment` (sum of per-sibling price increases) that
 * should be subtracted from the cancelled booking's refund.
 *
 * - Never lowers a sibling's price (we already charged the user that
 *   amount; lowering would misalign with what's on the payment).
 * - Mutates the passed `booking` object's `price` field after applying
 *   the adjustment so the caller's refund math uses the adjusted value.
 */
export async function adjustSiblingPricesForCancellation(
  booking: Booking,
): Promise<number> {
  if (!booking.userId || !booking.price) return 0;

  const center = await prisma.center.findUnique({
    where: { id: booking.centerId },
    select: { id: true, bookingModel: true },
  });
  if (!center) return 0;

  let consecutiveAdjustment = 0;
  try {
    if (center.bookingModel === 'RESOURCE_BASED') {
      consecutiveAdjustment = await adjustSiblingsResourceBased(booking, center.id);
    } else {
      consecutiveAdjustment = await adjustSiblingsMachinePitch(booking);
    }
  } catch (e) {
    console.error('[BookingCancel] Sibling reprice failed:', e);
    return 0;
  }

  if (consecutiveAdjustment > 0 && booking.price) {
    const adjustedPrice = Math.max(0, booking.price - consecutiveAdjustment);
    await prisma.booking.update({
      where: { id: booking.id },
      data: { price: adjustedPrice },
    });
    // Mirror the new value onto the caller's reference.
    booking.price = adjustedPrice;
  }
  return consecutiveAdjustment;
}

// ─── ABCA (MACHINE_PITCH) — legacy logic, lifted from /api/slots/cancel ──

async function adjustSiblingsMachinePitch(booking: Booking): Promise<number> {
  if (!booking.machineId || !booking.userId) return 0;

  const siblings = await prisma.booking.findMany({
    where: {
      id: { not: booking.id },
      userId: booking.userId,
      date: booking.date,
      machineId: booking.machineId,
      pitchType: booking.pitchType,
      status: 'BOOKED',
    },
    orderBy: { startTime: 'asc' },
  });
  if (siblings.length === 0) return 0;

  const ballType = booking.ballType || getBallTypeForMachine(booking.machineId);
  const category: 'MACHINE' | 'TENNIS' = MACHINE_A_BALLS.includes(ballType) ? 'MACHINE' : 'TENNIS';

  const pricingConfig = await getPricingConfig();
  const timeSlabConfig = await getTimeSlabConfig();

  const remainingSlots = siblings.map((b) => ({
    startTime: new Date(b.startTime),
    endTime: new Date(b.endTime),
  }));

  const newPricing = calculateNewPricing(
    remainingSlots,
    category,
    ballType,
    booking.pitchType,
    timeSlabConfig,
    pricingConfig,
    booking.machineId as MachineId,
  );

  // Re-apply recurring slot discounts so sibling prices match what
  // executeSlotBooking would have charged if they'd been booked alone.
  await reapplyRecurringDiscounts({
    booking,
    siblings,
    newPricing,
  });

  let adjustment = 0;
  for (let i = 0; i < siblings.length; i++) {
    const sibling = siblings[i];
    const newPrice = newPricing[i].price;
    const oldPrice = sibling.price || 0;
    const increase = newPrice - oldPrice;
    if (increase > 0) {
      adjustment += increase;
      await prisma.booking.update({
        where: { id: sibling.id },
        data: {
          price: newPrice,
          originalPrice: newPricing[i].originalPrice,
          discountAmount: newPricing[i].discountAmount > 0 ? newPricing[i].discountAmount : null,
          discountType: newPricing[i].discountAmount > 0 ? 'FIXED' : null,
        },
      });
    }
  }
  return adjustment;
}

async function reapplyRecurringDiscounts({
  booking,
  siblings,
  newPricing,
}: {
  booking: Booking;
  siblings: Booking[];
  newPricing: Array<{ price: number; originalPrice: number; discountAmount: number }>;
}): Promise<void> {
  let rules: Array<{
    days: number[];
    slotStartTime: string;
    slotEndTime: string | null;
    machineIds: string[];
    oneSlotDiscount: number;
    twoSlotDiscount: number;
  }> = [];
  try {
    rules = (await prisma.recurringSlotDiscount.findMany({
      where: { enabled: true, centerId: booking.centerId },
    })) as typeof rules;
  } catch {
    // Table or column may not exist on older DBs — skip silently.
    return;
  }
  if (rules.length === 0) return;

  const getISTTimeStr = (d: Date): string => {
    const istMs = d.getTime() + (5 * 60 + 30) * 60 * 1000;
    const ist = new Date(istMs);
    return `${ist.getUTCHours().toString().padStart(2, '0')}:${ist.getUTCMinutes().toString().padStart(2, '0')}`;
  };
  const getISTDay = (d: Date): number => {
    const istMs = d.getTime() + (5 * 60 + 30) * 60 * 1000;
    return new Date(istMs).getUTCDay();
  };

  const remainingConsecutive = siblings.length >= 2;
  const perSlotKey = remainingConsecutive ? 'twoSlotDiscount' : 'oneSlotDiscount';

  for (let i = 0; i < siblings.length; i++) {
    const start = siblings[i].startTime;
    const dow = getISTDay(start);
    const istTime = getISTTimeStr(start);

    for (const rule of rules) {
      if (!rule.days.includes(dow)) continue;
      const ruleStart = rule.slotStartTime.padStart(5, '0');
      const ruleEnd = (rule.slotEndTime || rule.slotStartTime).padStart(5, '0');
      if (istTime < ruleStart || istTime >= ruleEnd) continue;
      if (
        rule.machineIds &&
        rule.machineIds.length > 0 &&
        booking.machineId &&
        !rule.machineIds.includes(booking.machineId)
      ) {
        continue;
      }
      const discount = rule[perSlotKey];
      const reduction = Math.min(discount, newPricing[i].price);
      newPricing[i].price = Math.max(0, newPricing[i].price - reduction);
      newPricing[i].discountAmount += reduction;
      break;
    }
  }
}

// ─── Toplay (RESOURCE_BASED) — same idea via getResourceSlotPrice ────

async function adjustSiblingsResourceBased(booking: Booking, centerId: string): Promise<number> {
  if (!booking.userId) return 0;

  // Sibling set: same user, same date, same category, same assigned
  // machine (if MACHINE) / same assigned coach (if COACHING) / same
  // assigned staff (if SIDEARM). Same axes the pricing engine keys on.
  const siblings = await prisma.booking.findMany({
    where: {
      id: { not: booking.id },
      userId: booking.userId,
      centerId,
      date: booking.date,
      category: booking.category,
      status: 'BOOKED',
      ...(booking.assignedMachineId ? { assignedMachineId: booking.assignedMachineId } : {}),
      ...(booking.assignedCoachId ? { assignedCoachId: booking.assignedCoachId } : {}),
      ...(booking.assignedStaffId ? { assignedStaffId: booking.assignedStaffId } : {}),
      pitchType: booking.pitchType ?? null,
    },
    orderBy: { startTime: 'asc' },
  });
  if (siblings.length === 0) return 0;

  // Resolve the machine type code once so we don't re-read inside the loop.
  let machineTypeCode: string | null = null;
  if (booking.assignedMachineId) {
    const m = await prisma.machine.findUnique({
      where: { id: booking.assignedMachineId },
      select: { machineType: { select: { code: true } } },
    });
    machineTypeCode = m?.machineType.code ?? null;
  }

  const pricingConfig = await getResourcePricingConfig(centerId);

  // Recompute each sibling's price assuming the NEW set of siblings
  // (without the cancelled one). A sibling is "in a chain" if any
  // OTHER remaining sibling is adjacent to it (start==otherEnd or
  // end==otherStart). This mirrors planIsConsecutive in book-resource.
  let adjustment = 0;
  for (let i = 0; i < siblings.length; i++) {
    const s = siblings[i];
    const isConsecutive = siblings.some((q, j) => {
      if (i === j) return false;
      return (
        s.startTime.getTime() === q.endTime.getTime() ||
        s.endTime.getTime() === q.startTime.getTime()
      );
    });

    const newPrice = await getResourceSlotPrice({
      category: s.category,
      machineTypeCode,
      machineRowId: s.assignedMachineId,
      pitchType: s.pitchType,
      ballType: s.ballType,
      isConsecutive,
      startTime: s.startTime,
      centerId,
      pricingConfig,
    });

    const oldPrice = s.price || 0;
    const increase = newPrice - oldPrice;
    if (increase > 0) {
      adjustment += increase;
      await prisma.booking.update({
        where: { id: s.id },
        data: {
          price: newPrice,
          originalPrice: newPrice,
        },
      });
    }
  }
  return adjustment;
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
    // Booking.price is already post-adjustSiblingPricesForCancellation
    // so the remainder is the right amount to claw back to wallet.
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

    await safelyNotifyWalletCredit(booking.userId, remaining, walletResult.newBalance);

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

    await safelyNotifyWalletCredit(booking.userId, remaining, walletResult.newBalance);

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
    });
  } catch (err) {
    console.warn('[BookingCancel] Wallet credit notification failed:', err);
  }
}
