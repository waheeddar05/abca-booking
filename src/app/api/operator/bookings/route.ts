import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getOperatorSession } from '@/lib/adminAuth';
import { getISTTodayUTC, dateStringToUTC } from '@/lib/time';

export async function GET(req: NextRequest) {
  try {
    const session = await getOperatorSession(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const dateParam = searchParams.get('date');

    // Determine the target date
    const targetDate = dateParam && dateParam !== 'today'
      ? dateStringToUTC(dateParam)
      : getISTTodayUTC();

    // Get the operator's assigned machine IDs
    let machineIds: string[];

    if (session.isAdmin) {
      // Admins can see all machines
      machineIds = ['GRAVITY', 'YANTRA', 'LEVERAGE_INDOOR', 'LEVERAGE_OUTDOOR'];
    } else {
      const assignments = await prisma.operatorAssignment.findMany({
        where: { userId: session.userId },
        select: { machineId: true },
      });

      machineIds = assignments.map((a) => a.machineId);

      if (machineIds.length === 0) {
        return NextResponse.json({
          bookings: [],
          summary: { total: 0, booked: 0, done: 0, cancelled: 0 },
          machineIds: [],
        });
      }
    }

    // Fetch bookings for the assigned machines on the target date
    const bookings = await prisma.booking.findMany({
      where: {
        date: targetDate,
        machineId: { in: machineIds as any },
      },
      include: {
        user: { select: { name: true, email: true, mobileNumber: true } },
      },
      orderBy: [
        { machineId: 'asc' },
        { startTime: 'asc' },
      ],
    });

    // Calculate summary stats
    const booked = bookings.filter((b) => b.status === 'BOOKED').length;
    const done = bookings.filter((b) => b.status === 'DONE').length;
    const cancelled = bookings.filter((b) => b.status === 'CANCELLED').length;

    return NextResponse.json({
      bookings,
      summary: {
        total: bookings.length,
        booked,
        done,
        cancelled,
      },
      machineIds,
    });
  } catch (error: any) {
    console.error('Operator bookings fetch error:', error);
    return NextResponse.json(
      { error: error?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
