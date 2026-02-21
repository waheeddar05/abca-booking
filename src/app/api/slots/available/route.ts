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
import { getPricingConfig, getTimeSlabConfig, getSlotPrice, getTimeSlab } from '@/lib/pricing';
import { getAuthenticatedUser } from '@/lib/auth';

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
    try {
      const user = await getAuthenticatedUser(req);
      isAdmin = user?.role === 'ADMIN';
    } catch (e) {
      console.error('Error authenticating user in available slots:', e);
    }

    // Determine the machine and ball type
    let machineId: MachineId | null = null;
    let ballType: BallType;
    let category: 'MACHINE' | 'TENNIS';

    if (machineIdParam && isValidMachineId(machineIdParam)) {
      machineId = machineIdParam as MachineId;
      ballType = getBallTypeForMachine(machineId);
      category = getMachineCategory(machineId) === 'LEATHER' ? 'MACHINE' : 'TENNIS';
    } else {
      // Legacy: use ballType param
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

    // Fetch policies
    const policies = await prisma.policy.findMany({
      where: {
        key: { in: ['SLOT_DURATION', 'DISABLED_DATES', 'NUMBER_OF_OPERATORS', 'MACHINE_PITCH_CONFIG'] }
      }
    });

    const policyMap = Object.fromEntries(policies.map(p => [p.key, p.value]));

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

    const numberOfOperators = parseInt(policyMap['NUMBER_OF_OPERATORS'] || '1', 10);
    const duration = policyMap['SLOT_DURATION'] ? parseInt(policyMap['SLOT_DURATION']) : undefined;

    const [pricingConfig, timeSlabConfig, blockedSlots] = await Promise.all([
      getPricingConfig(),
      getTimeSlabConfig(),
      prisma.blockedSlot.findMany({
        where: {
          startDate: { lte: dateUTC },
          endDate: { gte: dateUTC },
        }
      }).catch((err: unknown) => {
        console.warn('BlockedSlot query failed (table may not exist yet):', err instanceof Error ? err.message : err);
        return [];
      })
    ]);

    // Generate slots using dual time windows
    let slots = generateSlotsForDateDualWindow(dateUTC, timeSlabConfig, duration);

    // If today, only future slots
    if (isSameDay(dateUTC, todayUTC)) {
      slots = filterPastSlots(slots);
    }

    const relevantBallTypes = getRelevantBallTypes(ballType);
    const isLeatherMachine = MACHINE_A_BALLS.includes(ballType);

    // Get bookings on the same machine
    const occupancyWhere: any = {
      date: dateUTC,
      status: 'BOOKED',
    };

    if (machineId) {
      // New: filter by specific machine
      occupancyWhere.machineId = machineId;
      if (validatedPitchType) {
        occupancyWhere.pitchType = validatedPitchType;
      }
    } else {
      // Legacy: filter by ball type group
      occupancyWhere.ballType = { in: relevantBallTypes };
      if (!isLeatherMachine && validatedPitchType) {
        occupancyWhere.pitchType = validatedPitchType;
      }
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
        // New: Match by machineId if the block specifies one
        if (block.machineId) {
          if (machineId && (block.machineId as MachineId) !== machineId) return false;
          if (!machineId) {
            // Legacy request: check if block's machineId is in the relevant machine category
            const blockIsLeather = LEATHER_MACHINES.includes(block.machineId as MachineId);
            if (isLeatherMachine !== blockIsLeather) return false;
          }
        }

        // Legacy: Match machine type
        if (block.machineType && !block.machineId) {
          const relevantTypes = getRelevantBallTypes(block.machineType);
          if (!relevantTypes.includes(ballType)) return false;
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
