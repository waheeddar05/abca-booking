import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { type BallType, type PitchType } from '@prisma/client';
import { generateSlotsForDateDualWindow, filterPastSlots, getISTTodayUTC, dateStringToUTC } from '@/lib/time';
import { isSameDay, isValid } from 'date-fns';
import { getRelevantBallTypes, isValidBallType, MACHINE_A_BALLS } from '@/lib/constants';
import { getPricingConfig, getTimeSlabConfig, getSlotPrice, getTimeSlab } from '@/lib/pricing';
import { getAuthenticatedUser } from '@/lib/auth';

function isValidPitchType(val: string): val is PitchType {
  return ['ASTRO', 'TURF'].includes(val);
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const dateStr = searchParams.get('date');
    const ballType = searchParams.get('ballType') || 'TENNIS';
    const pitchTypeParam = searchParams.get('pitchType');

    if (!dateStr) {
      return NextResponse.json({ error: 'Date is required' }, { status: 400 });
    }

    const dateUTC = dateStringToUTC(dateStr);

    let isAdmin = false;
    try {
      const user = await getAuthenticatedUser(req);
      isAdmin = user?.role === 'ADMIN';
    } catch (e) {
      console.error('Error authenticating user in available slots:', e);
    }

    // Validate ballType and determine machine
    if (!isValidBallType(ballType)) {
      return NextResponse.json({ error: 'Invalid ball type' }, { status: 400 });
    }
    const validatedBallType = ballType as BallType;

    let validatedPitchType: PitchType | null = null;
    // Default pitchType for LEATHER should be ASTRO if not specified
    if (validatedBallType === 'LEATHER' && !pitchTypeParam) {
      validatedPitchType = 'ASTRO';
    } else if (pitchTypeParam && isValidPitchType(pitchTypeParam)) {
      validatedPitchType = pitchTypeParam as PitchType;
    }

    if (!isValid(dateUTC)) {
      return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
    }

    // Check if date is in the past (using IST-aware today)
    const todayUTC = getISTTodayUTC();
    if (!isAdmin && dateUTC < todayUTC) {
      return NextResponse.json([]);
    }

    // Fetch policies
    if (!prisma.policy) {
      throw new Error('Prisma "policy" model is not defined');
    }
    const policies = await prisma.policy.findMany({
      where: {
        key: { in: ['SLOT_DURATION', 'DISABLED_DATES', 'NUMBER_OF_OPERATORS'] }
      }
    });

    const policyMap = Object.fromEntries(policies.map(p => [p.key, p.value]));

    // Check if date is disabled
    const disabledDates = policyMap['DISABLED_DATES'] ? policyMap['DISABLED_DATES'].split(',') : [];
    if (disabledDates.includes(dateStr)) {
      return NextResponse.json([]);
    }

    const numberOfOperators = parseInt(policyMap['NUMBER_OF_OPERATORS'] || '1', 10);
    const duration = policyMap['SLOT_DURATION'] ? parseInt(policyMap['SLOT_DURATION']) : undefined;

    const [pricingConfig, timeSlabConfig, blockedSlots] = await Promise.all([
      getPricingConfig(),
      getTimeSlabConfig(),
      prisma.blockedSlot ? prisma.blockedSlot.findMany({
        where: {
          startDate: { lte: dateUTC },
          endDate: { gte: dateUTC },
        }
      }) : Promise.resolve([])
    ]);

    // Generate slots using dual time windows
    let slots = generateSlotsForDateDualWindow(dateUTC, timeSlabConfig, duration);

    // If today, only future slots
    if (!isAdmin && isSameDay(dateUTC, todayUTC)) {
      slots = filterPastSlots(slots);
    }

    const relevantBallTypes = getRelevantBallTypes(validatedBallType);
    const isLeatherMachine = MACHINE_A_BALLS.includes(validatedBallType);
    const isTennisMachine = !isLeatherMachine;
    const category: 'MACHINE' | 'TENNIS' = isLeatherMachine ? 'MACHINE' : 'TENNIS';

    // Get bookings on the same machine
    const occupancyWhere: any = {
      date: dateUTC,
      ballType: { in: relevantBallTypes },
      status: 'BOOKED',
    };
    if (isTennisMachine && validatedPitchType) {
      occupancyWhere.pitchType = validatedPitchType;
    }

    if (!prisma.booking) {
      throw new Error('Prisma "booking" model is not defined');
    }
    const occupiedBookings = await prisma.booking.findMany({
      where: occupancyWhere,
      select: { startTime: true },
    });

    // Get ALL active bookings for this date to compute operator usage per slot
    let allBookings: { startTime: Date; ballType: BallType; operationMode: string }[] = [];
    try {
      allBookings = await prisma.booking.findMany({
        where: {
          date: dateUTC,
          status: 'BOOKED',
        },
        select: { startTime: true, ballType: true, operationMode: true },
      });
    } catch {
      const fallbackBookings = await prisma.booking.findMany({
        where: {
          date: dateUTC,
          status: 'BOOKED',
        },
        select: { startTime: true, ballType: true },
      });
      allBookings = fallbackBookings.map(b => ({ ...b, operationMode: 'WITH_OPERATOR' }));
    }

    // Build a map of startTime -> number of operators consumed
    const operatorUsageMap = new Map<number, number>();
    for (const booking of allBookings) {
      const timeKey = booking.startTime.getTime();
      const consumesOperator =
        MACHINE_A_BALLS.includes(booking.ballType) ||
        booking.operationMode === 'WITH_OPERATOR';

      if (consumesOperator) {
        operatorUsageMap.set(timeKey, (operatorUsageMap.get(timeKey) || 0) + 1);
      }
    }

    const availableSlots = slots.map(slot => {
      const timeKey = slot.startTime.getTime();

      const isOccupied = occupiedBookings.some(booking => {
        return booking.startTime.getTime() === timeKey;
      });

      // Check if slot is blocked by Admin
      const isBlocked = blockedSlots.some(block => {
        // Match machine type
        if (block.machineType) {
          const relevantTypes = getRelevantBallTypes(block.machineType);
          if (!relevantTypes.includes(validatedBallType)) return false;
        }

        // Match pitch type
        if (block.pitchType && block.pitchType !== validatedPitchType) {
          return false;
        }

        // Match time range
        if (block.startTime && block.endTime) {
          const getMinutes = (d: Date) => d.getUTCHours() * 60 + d.getUTCMinutes();
          const blockStartMin = getMinutes(block.startTime);
          const blockEndMin = getMinutes(block.endTime);
          const slotStartMin = getMinutes(slot.startTime);
          const slotEndMin = getMinutes(slot.endTime);

          // Overlap check
          return slotStartMin < blockEndMin && slotEndMin > blockStartMin;
        }

        return true; // Full day block if no startTime/endTime
      });

      const operatorsUsed = operatorUsageMap.get(timeKey) || 0;
      const operatorAvailable = operatorsUsed < numberOfOperators;

      // Calculate price using pricing config (per-machine/ball-type/time-slab)
      const timeSlab = getTimeSlab(slot.startTime, timeSlabConfig);
      const finalPrice = getSlotPrice(category, ballType, validatedPitchType, timeSlab, pricingConfig);

      // Determine slot status
      let status: string;
      if (isBlocked) {
        status = 'Blocked';
      } else if (isOccupied) {
        status = 'Booked';
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
        timeSlab,
      };
    });

    return NextResponse.json(availableSlots);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    const stack = error instanceof Error ? error.stack : undefined;
    console.error('Available slots error:', error);
    return NextResponse.json(
      { error: message, stack: process.env.NODE_ENV === 'development' ? stack : undefined },
      { status: 500 }
    );
  }
}
