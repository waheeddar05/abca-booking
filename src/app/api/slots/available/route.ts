import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateSlotsForDate, filterPastSlots } from '@/lib/time';
import { startOfDay, endOfDay, parseISO, isToday } from 'date-fns';
import { toDate } from 'date-fns-tz';
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

    // Machine A: LEATHER, MACHINE
    // Machine B: TENNIS
    // They are independent machines, so checking availability for one doesn't affect the other.
    
    // Check if date is in the past
    const today = startOfDay(toDate(new Date(), { timeZone: 'Asia/Kolkata' }));
    if (isBeforeDateOnly(date, today)) {
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
    if (isToday(date)) {
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

    const availableSlots = slots.map(slot => {
      const isOccupied = occupiedBookings.some(booking => {
        return booking.startTime.getTime() === slot.startTime.getTime();
      });
      return {
        startTime: slot.startTime.toISOString(),
        endTime: slot.endTime.toISOString(),
        status: isOccupied ? 'Booked' : 'Available'
      };
    });

    return NextResponse.json(availableSlots);
  } catch (error) {
    console.error('Available slots error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

function isBeforeDateOnly(d1: Date, d2: Date) {
  return startOfDay(d1) < startOfDay(d2);
}
