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
