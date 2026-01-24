import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { startOfDay, endOfDay, parseISO } from 'date-fns';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const dateStr = searchParams.get('date');

    if (!dateStr) {
      return NextResponse.json({ error: 'Date is required' }, { status: 400 });
    }

    const date = parseISO(dateStr);

    const occupiedBookings = await prisma.booking.findMany({
      where: {
        date: {
          gte: startOfDay(date),
          lte: endOfDay(date),
        },
        status: 'BOOKED',
      },
      select: {
        startTime: true,
        endTime: true,
      }
    });

    return NextResponse.json(occupiedBookings);
  } catch (error) {
    console.error('Occupied slots error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
