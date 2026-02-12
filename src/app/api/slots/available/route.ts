import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateSlotsForDate, filterPastSlots, getISTTodayUTC, dateStringToUTC } from '@/lib/time';
import { startOfDay, endOfDay, parseISO, isSameDay } from 'date-fns';
import { getRelevantBallTypes, isValidBallType } from '@/lib/constants';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const dateStr = searchParams.get('date');
    const ballType = searchParams.get('ballType') || 'TENNIS';

    if (!dateStr) {
      return NextResponse.json({ error: 'Date is required' }, { status: 400 });
    }

    const date = parseISO(dateStr);

    // Validate ballType and determine machine
    if (!isValidBallType(ballType)) {
      return NextResponse.json({ error: 'Invalid ball type' }, { status: 400 });
    }

    // Check if date is in the past (using IST-aware today)
    const todayUTC = getISTTodayUTC();
    const dateUTC = dateStringToUTC(dateStr);
    if (dateUTC < todayUTC) {
      return NextResponse.json([]);
    }

    // Fetch policies
    const policies = await prisma.policy.findMany({
      where: {
        key: { in: ['SLOT_WINDOW_START', 'SLOT_WINDOW_END', 'SLOT_DURATION', 'DISABLED_DATES'] }
      }
    });

    const policyMap = Object.fromEntries(policies.map(p => [p.key, p.value]));

    // Check if date is disabled
    const disabledDates = policyMap['DISABLED_DATES'] ? policyMap['DISABLED_DATES'].split(',') : [];
    if (disabledDates.includes(dateStr)) {
      return NextResponse.json([]);
    }

    const config = {
      startHour: policyMap['SLOT_WINDOW_START'] ? parseInt(policyMap['SLOT_WINDOW_START']) : undefined,
      endHour: policyMap['SLOT_WINDOW_END'] ? parseInt(policyMap['SLOT_WINDOW_END']) : undefined,
      duration: policyMap['SLOT_DURATION'] ? parseInt(policyMap['SLOT_DURATION']) : undefined,
    };

    let slots = generateSlotsForDate(date, config);

    // If today, only future slots
    if (isSameDay(dateUTC, todayUTC)) {
      slots = filterPastSlots(slots);
    }

    // Machine A: LEATHER, MACHINE
    // Machine B: TENNIS
    const relevantBallTypes = getRelevantBallTypes(ballType);

    const occupiedBookings = await prisma.booking.findMany({
      where: {
        date: {
          gte: startOfDay(date),
          lte: endOfDay(date),
        },
        ballType: { in: relevantBallTypes as any },
        status: 'BOOKED',
      },
    });

    // Fetch slot prices from admin-created slots
    const adminSlots = await prisma.slot.findMany({
      where: {
        date: dateUTC,
        isActive: true,
      },
      select: { startTime: true, price: true },
    });

    // Get machine config for extra charges
    const machineConfigPolicies = await prisma.policy.findMany({
      where: {
        key: { in: ['DEFAULT_SLOT_PRICE', 'LEATHER_BALL_EXTRA_CHARGE', 'MACHINE_BALL_EXTRA_CHARGE', 'ASTRO_PITCH_PRICE', 'TURF_PITCH_PRICE'] },
      },
    });
    const mcMap = Object.fromEntries(machineConfigPolicies.map(p => [p.key, p.value]));
    const defaultPrice = parseFloat(mcMap['DEFAULT_SLOT_PRICE'] || '600');

    const availableSlots = slots.map(slot => {
      const isOccupied = occupiedBookings.some(booking => {
        return booking.startTime.getTime() === slot.startTime.getTime();
      });

      // Find admin-set price for this slot
      const adminSlot = adminSlots.find(s => s.startTime.getTime() === slot.startTime.getTime());
      const basePrice = adminSlot?.price ?? defaultPrice;

      return {
        startTime: slot.startTime.toISOString(),
        endTime: slot.endTime.toISOString(),
        status: isOccupied ? 'Booked' : 'Available',
        price: basePrice,
      };
    });

    return NextResponse.json(availableSlots);
  } catch (error) {
    console.error('Available slots error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
