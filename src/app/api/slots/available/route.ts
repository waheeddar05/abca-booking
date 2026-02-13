import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { type BallType, type PitchType } from '@prisma/client';
import { generateSlotsForDateDualWindow, filterPastSlots, getISTTodayUTC, dateStringToUTC } from '@/lib/time';
import { isSameDay, isValid } from 'date-fns';
import { getRelevantBallTypes, isValidBallType, MACHINE_A_BALLS } from '@/lib/constants';
import { getPricingConfig, getTimeSlabConfig, getSlotPrice, getTimeSlab } from '@/lib/pricing';

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

    // Validate ballType and determine machine
    if (!isValidBallType(ballType)) {
      return NextResponse.json({ error: 'Invalid ball type' }, { status: 400 });
    }
    const validatedBallType = ballType as BallType;

    // Validate pitchType if provided
    let validatedPitchType: PitchType | null = null;
    if (pitchTypeParam && isValidPitchType(pitchTypeParam)) {
      validatedPitchType = pitchTypeParam as PitchType;
    }

    if (!isValid(dateUTC)) {
      return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
    }

    // Check if date is in the past (using IST-aware today)
    const todayUTC = getISTTodayUTC();
    if (dateUTC < todayUTC) {
      return NextResponse.json([]);
    }

    // Fetch policies
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

    // Fetch pricing and time slab config
    const [pricingConfig, timeSlabConfig] = await Promise.all([
      getPricingConfig(),
      getTimeSlabConfig(),
    ]);

    // Generate slots using dual time windows
    let slots = generateSlotsForDateDualWindow(dateUTC, timeSlabConfig, duration);

    // If today, only future slots
    if (isSameDay(dateUTC, todayUTC)) {
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

    // Fetch slot prices from admin-created slots
    let adminSlots: { startTime: Date; price: number }[] = [];
    try {
      adminSlots = await prisma.slot.findMany({
        where: {
          date: dateUTC,
          isActive: true,
        },
        select: { startTime: true, price: true },
      });
    } catch {
      // Slot table may not exist yet
    }

    const availableSlots = slots.map(slot => {
      const timeKey = slot.startTime.getTime();

      const isOccupied = occupiedBookings.some(booking => {
        return booking.startTime.getTime() === timeKey;
      });

      const operatorsUsed = operatorUsageMap.get(timeKey) || 0;
      const operatorAvailable = operatorsUsed < numberOfOperators;

      // Calculate price using new pricing model
      const timeSlab = getTimeSlab(slot.startTime, timeSlabConfig);
      const slotPrice = getSlotPrice(category, ballType, validatedPitchType, timeSlab, pricingConfig);

      // If admin has set a custom price for this specific slot, use that
      const adminSlot = adminSlots.find(s => s.startTime.getTime() === timeKey);
      const finalPrice = adminSlot?.price ?? slotPrice;

      // Determine slot status
      let status: string;
      if (isOccupied) {
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
