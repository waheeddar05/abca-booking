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

    // Determine the target date (or all upcoming)
    const isAllMode = dateParam === 'all';
    const targetDate = !isAllMode
      ? (dateParam && dateParam !== 'today' ? dateStringToUTC(dateParam) : getISTTodayUTC())
      : null;

    // Build booking filter based on role
    let machineIds: string[];
    let bookingWhere: any;

    if (session.isAdmin) {
      // Admins see all bookings
      machineIds = ['GRAVITY', 'YANTRA', 'LEVERAGE_INDOOR', 'LEVERAGE_OUTDOOR'];
    } else {
      // Get operator's assigned machines
      const assignments = await prisma.operatorAssignment.findMany({
        where: { userId: session.userId },
        select: { machineId: true },
      });

      machineIds = assignments.map((a) => a.machineId);

      // Fallback: if no machine assignments, show all machines
      if (machineIds.length === 0) {
        machineIds = ['GRAVITY', 'YANTRA', 'LEVERAGE_INDOOR', 'LEVERAGE_OUTDOOR'];
      }
    }

    // All operators and admins see ALL bookings on their machines
    // The UI highlights which ones are assigned to the current operator
    bookingWhere = {
      machineId: { in: machineIds as any },
    } as any;

    if (isAllMode) {
      // Show today and future bookings
      bookingWhere.date = { gte: getISTTodayUTC() };
    } else {
      bookingWhere.date = targetDate;
    }

    // Fetch bookings
    const bookings = await prisma.booking.findMany({
      where: bookingWhere,
      include: {
        user: { select: { name: true, email: true, mobileNumber: true } },
      },
      orderBy: [
        ...(isAllMode ? [{ date: 'asc' as const }] : []),
        { machineId: 'asc' as const },
        { startTime: 'asc' as const },
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
      currentOperatorId: session.userId,
    });
  } catch (error: any) {
    console.error('Operator bookings fetch error:', error);
    return NextResponse.json(
      { error: error?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
