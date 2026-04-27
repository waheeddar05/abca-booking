import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/adminAuth';
import { getAuthenticatedUser } from '@/lib/auth';
import { resolveCurrentCenter } from '@/lib/centers';
import { getISTTodayUTC, getISTTime } from '@/lib/time';
import { subDays } from 'date-fns';

type PeriodType = 'today' | 'week' | 'month' | 'all';

interface OperatorStats {
  id: string;
  name: string | null;
  mobileNumber: string | null;
  totalBookings: number;
  todayBookings: number;
  upcomingBookings: number;
  machineBreakdown: Record<string, number>;
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireAdmin(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Parse query parameters
    const { searchParams } = new URL(req.url);
    const period = (searchParams.get('period') || 'today') as PeriodType;

    if (!['today', 'week', 'month', 'all'].includes(period)) {
      return NextResponse.json(
        { error: 'Invalid period. Must be one of: today, week, month, all' },
        { status: 400 }
      );
    }

    const allCenters = searchParams.get('allCenters') === 'true';
    const adminUser = await getAuthenticatedUser(req);
    const center = adminUser ? await resolveCurrentCenter(req, adminUser) : null;
    let centerId: string | null = null;
    if (!allCenters && center) {
      centerId = center.id;
    } else if (!allCenters && !center) {
      return NextResponse.json({ error: 'No center selected' }, { status: 400 });
    } else if (allCenters && !adminUser?.isSuperAdmin) {
      return NextResponse.json({ error: 'allCenters requires super admin' }, { status: 403 });
    }

    // Get IST dates
    const todayUTC = getISTTodayUTC();
    const nowIST = getISTTime();

    // Determine date range based on period
    let dateRangeStart: Date | null = null;
    let dateRangeEnd: Date | null = null;

    if (period === 'today') {
      dateRangeStart = todayUTC;
      dateRangeEnd = todayUTC;
    } else if (period === 'week') {
      const sevenDaysAgo = subDays(todayUTC, 7);
      dateRangeStart = sevenDaysAgo;
      dateRangeEnd = todayUTC;
    } else if (period === 'month') {
      const thirtyDaysAgo = subDays(todayUTC, 30);
      dateRangeStart = thirtyDaysAgo;
      dateRangeEnd = todayUTC;
    }
    // For 'all', dateRangeStart and dateRangeEnd remain null

    // Fetch operators — filtered to those with active membership at the
    // current center when not in allCenters mode.
    const operators = await prisma.user.findMany({
      where: centerId
        ? { role: 'OPERATOR', centerMemberships: { some: { centerId, isActive: true } } }
        : { role: 'OPERATOR' },
      select: {
        id: true,
        name: true,
        mobileNumber: true,
      },
    });

    // Build where clause for bookings
    const bookingWhereClause: Record<string, unknown> = {
      operatorId: { in: operators.map(op => op.id) },
      status: { not: 'CANCELLED' },
    };
    if (centerId) bookingWhereClause.centerId = centerId;

    if (dateRangeStart && dateRangeEnd) {
      bookingWhereClause.date = {
        gte: dateRangeStart,
        lte: dateRangeEnd,
      };
    }

    // Fetch all relevant bookings with aggregation
    const allBookings = await prisma.booking.findMany({
      where: bookingWhereClause,
      select: {
        operatorId: true,
        machineId: true,
        date: true,
        startTime: true,
        status: true,
      },
    });

    // Build stats object
    const statsMap: Record<string, OperatorStats> = {};

    // Initialize each operator
    for (const op of operators) {
      statsMap[op.id] = {
        id: op.id,
        name: op.name || null,
        mobileNumber: op.mobileNumber || null,
        totalBookings: 0,
        todayBookings: 0,
        upcomingBookings: 0,
        machineBreakdown: {},
      };
    }

    // Process bookings
    for (const booking of allBookings) {
      if (!booking.operatorId) continue;

      const stats = statsMap[booking.operatorId];
      if (!stats) continue;

      // Increment total bookings
      stats.totalBookings += 1;

      // Increment today bookings
      if (booking.date.getTime() === todayUTC.getTime()) {
        stats.todayBookings += 1;
      }

      // Increment upcoming bookings (date > today AND startTime > now)
      if (booking.date > todayUTC) {
        stats.upcomingBookings += 1;
      } else if (booking.date.getTime() === todayUTC.getTime() && booking.startTime > nowIST) {
        stats.upcomingBookings += 1;
      }

      // Machine breakdown
      const machineId = booking.machineId || 'UNKNOWN';
      if (!stats.machineBreakdown[machineId]) {
        stats.machineBreakdown[machineId] = 0;
      }
      stats.machineBreakdown[machineId] += 1;
    }

    // Convert to array and filter out operators with no bookings if needed
    const operatorStats = Object.values(statsMap);

    return NextResponse.json(
      {
        period,
        operators: operatorStats,
        total: operatorStats.length,
      },
      {
        headers: {
          'Cache-Control': 'private, s-maxage=30, stale-while-revalidate=60',
        },
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    console.error('Operator stats fetch error:', error);
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
