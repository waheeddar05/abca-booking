import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { type BallType, type PitchType, type MachineId } from '@prisma/client';
import { generateSlotsForDateDualWindow, filterPastSlots, getISTTodayUTC, dateStringToUTC } from '@/lib/time';
import { isSameDay, isValid } from 'date-fns';
import {
  getRelevantBallTypes, isValidBallType, MACHINE_A_BALLS,
  isValidMachineId, getBallTypeForMachine, getMachineCategory,
  DEFAULT_MACHINE_PITCH_CONFIG, LEATHER_MACHINES,
} from '@/lib/constants';
import type { MachinePitchConfig } from '@/lib/constants';
import { getPricingConfig, getTimeSlabConfig, getSlotPrice, getTimeSlab, timeToMinutes } from '@/lib/pricing';
import { getCachedPolicies } from '@/lib/policy-cache';
import { getAuthenticatedUser } from '@/lib/auth';
import { resolveCurrentCenter } from '@/lib/centers';
import { getOperatorCount } from '@/lib/operatorAssign';

function isValidPitchTypeValue(val: string): val is PitchType {
  return ['ASTRO', 'CEMENT', 'NATURAL', 'TURF'].includes(val);
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const dateStr = searchParams.get('date');
    const ballTypeParam = searchParams.get('ballType') || 'TENNIS';
    const pitchTypeParam = searchParams.get('pitchType');
    const machineIdParam = searchParams.get('machineId');

    if (!dateStr) {
      return NextResponse.json({ error: 'Date is required' }, { status: 400 });
    }

    const dateUTC = dateStringToUTC(dateStr);

    let isAdmin = false;
    let isSpecialUser = false;
    let authedUser: Awaited<ReturnType<typeof getAuthenticatedUser>> = null;
    try {
      authedUser = await getAuthenticatedUser(req);
      isAdmin = authedUser?.role === 'ADMIN';
      isSpecialUser = !!authedUser?.isSpecialUser;
    } catch (e) {
      console.error('Error authenticating user in available slots:', e);
    }

    // Resolve the center the slot list applies to. Anonymous public visitors
    // get the default active center; authed users get their cookie/membership.
    const center = await resolveCurrentCenter(req, authedUser);
    if (!center) {
      return NextResponse.json({ error: 'No center available' }, { status: 503 });
    }
    const centerId = center.id;

    // Determine the machine and ball type
    let machineId: MachineId | null = null;
    let ballType: BallType;
    let category: 'MACHINE' | 'TENNIS';

    if (machineIdParam && isValidMachineId(machineIdParam)) {
      machineId = machineIdParam as MachineId;
      ballType = (isValidBallType(ballTypeParam)) ? ballTypeParam as BallType : getBallTypeForMachine(machineId);
      category = getMachineCategory(machineId) === 'LEATHER' ? 'MACHINE' : 'TENNIS';
    } else {
      if (!isValidBallType(ballTypeParam)) {
        return NextResponse.json({ error: 'Invalid ball type' }, { status: 400 });
      }
      ballType = ballTypeParam as BallType;
      const isLeatherMachine = MACHINE_A_BALLS.includes(ballType);
      category = isLeatherMachine ? 'MACHINE' : 'TENNIS';
    }

    let validatedPitchType: PitchType | null = null;
    if (pitchTypeParam && isValidPitchTypeValue(pitchTypeParam)) {
      validatedPitchType = pitchTypeParam as PitchType;
    } else if (ballType === 'LEATHER' && !pitchTypeParam) {
      validatedPitchType = 'ASTRO';
    }

    if (!isValid(dateUTC)) {
      return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
    }

    // Check if date is in the past (using IST-aware today)
    const todayUTC = getISTTodayUTC();
    if (!isAdmin && dateUTC < todayUTC) {
      return NextResponse.json([]);
    }

    // Fetch all data in parallel: policies (cached), pricing, time slabs, blocked slots, ALL bookings, discounts, and promo offers
    const [policyMap, pricingConfig, timeSlabConfig, blockedSlots, allBookings, recurringDiscounts, activePromoOffers] = await Promise.all([
      getCachedPolicies(['SLOT_DURATION', 'DISABLED_DATES', 'NUMBER_OF_OPERATORS', 'MACHINE_PITCH_CONFIG']),
      getPricingConfig(),
      getTimeSlabConfig(),
      prisma.blockedSlot.findMany({
        where: {
          centerId,
          startDate: { lte: dateUTC },
          endDate: { gte: dateUTC },
        },
      }).catch((err: unknown) => {
        console.warn('BlockedSlot query failed:', err instanceof Error ? err.message : err);
        return [];
      }),
      // Single booking query for both occupancy and operator usage (replaces two separate queries)
      prisma.booking.findMany({
        where: {
          centerId,
          date: dateUTC,
          status: 'BOOKED',
        },
        select: { startTime: true, ballType: true, operationMode: true, machineId: true, pitchType: true },
      }),
      // Fetch active recurring slot discounts at this center
      prisma.recurringSlotDiscount.findMany({
        where: { centerId, enabled: true },
      }).catch(() => []),
      // Fetch active promotional offers for the selected date at this center
      prisma.promotionalOffer.findMany({
        where: {
          centerId,
          isActive: true,
          startDate: { lte: dateUTC },
          endDate: { gte: dateUTC },
        },
      }).catch(() => []),
    ]);

    // Check if date is disabled
    const disabledDates = policyMap['DISABLED_DATES'] ? policyMap['DISABLED_DATES'].split(',') : [];
    if (disabledDates.includes(dateStr)) {
      return NextResponse.json([]);
    }

    // Machine-pitch compatibility check
    let machinePitchConfig: MachinePitchConfig = DEFAULT_MACHINE_PITCH_CONFIG;
    if (policyMap['MACHINE_PITCH_CONFIG']) {
      try {
        machinePitchConfig = JSON.parse(policyMap['MACHINE_PITCH_CONFIG']);
      } catch { /* use default */ }
    }

    if (machineId && validatedPitchType) {
      const allowedPitches = machinePitchConfig[machineId] || [];
      if (!allowedPitches.includes(validatedPitchType)) {
        return NextResponse.json({ error: `Pitch type ${validatedPitchType} is not enabled for this machine` }, { status: 400 });
      }
    }

    // Legacy fallback — getOperatorCount() already reads the policy cache
    const legacyNumberOfOperators = parseInt(policyMap['NUMBER_OF_OPERATORS'] || '1', 10);
    const duration = policyMap['SLOT_DURATION'] ? parseInt(policyMap['SLOT_DURATION']) : undefined;

    // Generate slots using dual time windows
    let slots = generateSlotsForDateDualWindow(dateUTC, timeSlabConfig, duration);

    // If today, only future slots
    if (isSameDay(dateUTC, todayUTC)) {
      slots = filterPastSlots(slots);
    }

    const relevantBallTypes = getRelevantBallTypes(ballType);
    const isLeatherMachine = MACHINE_A_BALLS.includes(ballType);

    // Build occupancy and operator usage maps from single query
    const occupiedTimeKeys = new Set<number>();
    const operatorUsageMap = new Map<number, number>();

    for (const booking of allBookings) {
      const timeKey = booking.startTime.getTime();

      // Check if this booking occupies the requested machine/pitch
      let isOccupying = false;
      if (machineId) {
        isOccupying = booking.machineId === machineId;
      } else {
        const matchesBallType = relevantBallTypes.includes(booking.ballType);
        const matchesPitch = !isLeatherMachine && validatedPitchType
          ? booking.pitchType === validatedPitchType
          : true;
        isOccupying = matchesBallType && matchesPitch;
      }

      if (isOccupying) {
        occupiedTimeKeys.add(timeKey);
      }

      // Operator usage tracking
      const consumesOperator =
        MACHINE_A_BALLS.includes(booking.ballType) ||
        booking.operationMode === 'WITH_OPERATOR';

      if (consumesOperator) {
        operatorUsageMap.set(timeKey, (operatorUsageMap.get(timeKey) || 0) + 1);
      }
    }

    // Pre-compute operator counts per slot (async)
    const operatorCountsMap = new Map<number, number>();
    for (const slot of slots) {
      const timeKey = slot.startTime.getTime();
      if (!operatorCountsMap.has(timeKey)) {
        const count = await getOperatorCount(dateUTC, slot.startTime, timeSlabConfig);
        operatorCountsMap.set(timeKey, count);
      }
    }

    // Helper: locale-independent IST time extraction
    function getISTTime(d: Date): string {
      const istMs = d.getTime() + (5 * 60 + 30) * 60 * 1000;
      const istDate = new Date(istMs);
      return `${istDate.getUTCHours().toString().padStart(2, '0')}:${istDate.getUTCMinutes().toString().padStart(2, '0')}`;
    }
    function getISTDay(d: Date): number {
      const istMs = d.getTime() + (5 * 60 + 30) * 60 * 1000;
      return new Date(istMs).getUTCDay();
    }

    // Helper to find recurring discount for a slot
    function getRecurringDiscount(slotStart: Date): { oneSlotDiscount: number; twoSlotDiscount: number } | null {
      const dayOfWeek = getISTDay(slotStart);
      const istTimeStr = getISTTime(slotStart);

      for (const rule of recurringDiscounts) {
        if (!rule.days.includes(dayOfWeek)) continue;
        const ruleStartTime = rule.slotStartTime.padStart(5, '0');
        const ruleEndTime = (rule.slotEndTime || rule.slotStartTime).padStart(5, '0');
        // Check if slot falls within the rule's time range [start, end)
        if (istTimeStr < ruleStartTime || istTimeStr >= ruleEndTime) continue;
        if (rule.machineIds && rule.machineIds.length > 0 && machineId && !rule.machineIds.includes(machineId)) continue;
        return { oneSlotDiscount: rule.oneSlotDiscount, twoSlotDiscount: rule.twoSlotDiscount };
      }
      return null;
    }

    // Helper to find best applicable promotional offer for a slot
    function getPromoDiscount(slotStart: Date, slotPrice: number): { name: string; discountType: 'PERCENTAGE' | 'FIXED'; discountValue: number; discountAmount: number } | null {
      const dayOfWeek = getISTDay(slotStart);
      const istTimeStr = getISTTime(slotStart);
      const slotMinutes = timeToMinutes(istTimeStr);

      let bestOffer: typeof activePromoOffers[0] | null = null;
      let bestAmount = 0;

      for (const offer of activePromoOffers) {
        // appliesTo filter
        if (offer.appliesTo === 'SPECIAL' && !isSpecialUser) continue;

        // Day of week filter
        if (offer.days && offer.days.length > 0 && !offer.days.includes(dayOfWeek)) continue;

        // Time slot filter
        if (offer.timeSlotStart && offer.timeSlotEnd) {
          const offerStart = timeToMinutes(offer.timeSlotStart);
          const offerEnd = timeToMinutes(offer.timeSlotEnd);
          if (slotMinutes < offerStart || slotMinutes >= offerEnd) continue;
        }

        // Machine filter
        if (offer.machineIds && offer.machineIds.length > 0 && machineId && !offer.machineIds.includes(machineId)) continue;

        // Pitch type filter
        if (offer.pitchTypes && offer.pitchTypes.length > 0 && validatedPitchType && !offer.pitchTypes.includes(validatedPitchType)) continue;

        // Calculate discount amount
        const amount = offer.discountType === 'PERCENTAGE'
          ? (slotPrice * offer.discountValue) / 100
          : offer.discountValue;

        if (amount > bestAmount) {
          bestAmount = amount;
          bestOffer = offer;
        }
      }

      if (!bestOffer || bestAmount <= 0) return null;

      return {
        name: bestOffer.name,
        discountType: bestOffer.discountType as 'PERCENTAGE' | 'FIXED',
        discountValue: bestOffer.discountValue,
        discountAmount: Math.min(bestAmount, slotPrice),
      };
    }

    const availableSlots = slots.map(slot => {
      const timeKey = slot.startTime.getTime();
      const isOccupied = occupiedTimeKeys.has(timeKey);

      // Check if slot is blocked by Admin
      const isBlocked = blockedSlots.some(block => {
        // Check appliesTo: skip blocks not targeting this user type
        if (block.appliesTo === 'SPECIAL' && !isSpecialUser) return false;
        if (block.appliesTo === 'NON_SPECIAL' && isSpecialUser) return false;

        // Check recurring days: if block has recurringDays, only block on those days
        if (block.recurringDays && block.recurringDays.length > 0) {
          const dayOfWeek = dateUTC.getUTCDay();
          if (!block.recurringDays.includes(dayOfWeek)) return false;
        }

        // Check machineIds array (new multi-machine blocks)
        if (block.machineIds && block.machineIds.length > 0) {
          if (machineId && !block.machineIds.includes(machineId)) return false;
          if (!machineId) {
            // Legacy: check if any of the blocked machines match category
            const anyMatchCategory = block.machineIds.some(mid =>
              isLeatherMachine === LEATHER_MACHINES.includes(mid as MachineId)
            );
            if (!anyMatchCategory) return false;
          }
        } else if (block.machineId) {
          if (machineId && (block.machineId as MachineId) !== machineId) return false;
          if (!machineId) {
            const blockIsLeather = LEATHER_MACHINES.includes(block.machineId as MachineId);
            if (isLeatherMachine !== blockIsLeather) return false;
          }
        }

        if (block.machineType && !block.machineId && !(block.machineIds && block.machineIds.length > 0)) {
          const relevantTypes = getRelevantBallTypes(block.machineType);
          if (!relevantTypes.includes(ballType)) return false;
        }

        if (block.pitchType && block.pitchType !== validatedPitchType) {
          return false;
        }

        if (block.startTime && block.endTime) {
          const getMinutes = (d: Date) => d.getUTCHours() * 60 + d.getUTCMinutes();
          const blockStartMin = getMinutes(block.startTime);
          const blockEndMin = getMinutes(block.endTime);
          const slotStartMin = getMinutes(slot.startTime);
          const slotEndMin = getMinutes(slot.endTime);

          return slotStartMin < blockEndMin && slotEndMin > blockStartMin;
        }

        return true;
      });

      const operatorsUsed = operatorUsageMap.get(timeKey) || 0;
      const numberOfOperators = operatorCountsMap.has(timeKey) ? operatorCountsMap.get(timeKey)! : legacyNumberOfOperators;
      const operatorAvailable = operatorsUsed < numberOfOperators;

      // Calculate price using pricing config
      const timeSlab = getTimeSlab(slot.startTime, timeSlabConfig);
      const finalPrice = getSlotPrice(category, ballType, validatedPitchType, timeSlab, pricingConfig, machineId);

      // Check for recurring slot discount badge
      const recurringDiscount = getRecurringDiscount(slot.startTime);

      // Check for promotional offer discount
      const promoDiscount = getPromoDiscount(slot.startTime, finalPrice);

      // Determine slot status
      let status: string;
      let selfOperate = false;
      if (isBlocked) {
        status = 'Blocked';
      } else if (isOccupied) {
        status = 'Booked';
      } else if (numberOfOperators === 0) {
        // Zero operators configured: leather machines unavailable, tennis machines self-operate
        if (isLeatherMachine) {
          status = 'Blocked';
        } else {
          status = 'Available';
          selfOperate = true;
        }
      } else if (isLeatherMachine && !operatorAvailable) {
        status = 'OperatorUnavailable';
      } else {
        status = 'Available';
      }

      return {
        startTime: slot.startTime.toISOString(),
        endTime: slot.endTime.toISOString(),
        status,
        price: finalPrice,
        operatorAvailable,
        selfOperate,
        timeSlab,
        ...(recurringDiscount ? { recurringDiscount } : {}),
        ...(promoDiscount ? { promoDiscount } : {}),
      };
    });

    return NextResponse.json(availableSlots);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('Available slots error:', error);
    return NextResponse.json(
      { error: message, stack: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.stack : undefined) : undefined },
      { status: 500 }
    );
  }
}
