import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateSlotsForDate, filterPastSlots } from '@/lib/time';
import { startOfDay, endOfDay, parseISO, isToday } from 'date-fns';
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
    const today = startOfDay(new Date());
    if (isBeforeDateOnly(date, today)) {
      return NextResponse.json([]);
    }

    let slots = generateSlotsForDate(date);

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
