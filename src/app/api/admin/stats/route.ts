import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/adminAuth';
import { getISTTodayUTC, getISTLastMonthRange, dateStringToUTC } from '@/lib/time';

export async function GET(req: NextRequest) {
  try {
    const session = await requireAdmin(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const fromParam = searchParams.get('from');
    const toParam = searchParams.get('to');

    // Build date filter for queries
    const dateFilter: Record<string, Date> = {};
    if (fromParam) dateFilter.gte = dateStringToUTC(fromParam);
    if (toParam) dateFilter.lte = dateStringToUTC(toParam);
    const hasDateFilter = Object.keys(dateFilter).length > 0;

    const todayUTC = getISTTodayUTC();
    const lastMonthRange = getISTLastMonthRange();

    // Run ALL queries in a single Promise.all for maximum parallelism
    const [
      totalBookings,
      activeAdmins,
      todayBookings,
      upcomingBookings,
      lastMonthBookings,
      totalSlots,
      bookingRevenueValue,
      totalDiscountValue,
      packageRevenueValue,
      machineRevenue,
      selfOperatedBookings,
      unassignedBookings,
      operatorSummary,
    ] = await Promise.all([
      prisma.booking.count({
        where: {
          status: { not: 'CANCELLED' },
          ...(hasDateFilter ? { date: dateFilter } : {}),
        },
      }),
      prisma.user.count({ where: { role: 'ADMIN' } }),
      prisma.booking.count({
        where: { date: todayUTC, status: { not: 'CANCELLED' } },
      }),
      prisma.booking.count({
        where: { date: { gt: todayUTC }, status: 'BOOKED' },
      }),
      prisma.booking.count({
        where: {
          date: {
            gte: lastMonthRange.start,
            lte: lastMonthRange.end,
          },
          status: { not: 'CANCELLED' },
        },
      }),
      prisma.slot.count().catch(() => 0),
      // Booking revenue
      prisma.booking.aggregate({
        _sum: { price: true },
        where: {
          status: { in: ['BOOKED', 'DONE'] },
          isSuperAdminBooking: false,
          ...(hasDateFilter ? { date: dateFilter } : {}),
        },
      }).then(r => r._sum.price || 0).catch(() => 0),
      // Discount
      prisma.booking.aggregate({
        _sum: { discountAmount: true },
        where: {
          status: { in: ['BOOKED', 'DONE'] },
          isSuperAdminBooking: false,
          discountAmount: { gt: 0 },
          ...(hasDateFilter ? { date: dateFilter } : {}),
        },
      }).then(r => r._sum.discountAmount || 0).catch(() => 0),
      // Package revenue
      prisma.userPackage.aggregate({
        _sum: { amountPaid: true },
        where: {
          status: { in: ['ACTIVE', 'EXPIRED'] },
          ...(hasDateFilter ? { createdAt: dateFilter } : {}),
        },
      }).then(r => r._sum.amountPaid || 0).catch(() => 0),
      // Machine-wise revenue
      prisma.booking.groupBy({
        by: ['machineId'],
        _sum: { price: true },
        where: {
          status: { in: ['BOOKED', 'DONE'] },
          isSuperAdminBooking: false,
          machineId: { not: null },
          ...(hasDateFilter ? { date: dateFilter } : {}),
        },
      }).catch(() => []),
      // Self-operated bookings
      prisma.booking.count({
        where: {
          status: { not: 'CANCELLED' },
          operationMode: 'SELF_OPERATE',
          ...(hasDateFilter ? { date: dateFilter } : {}),
        },
      }).catch(() => 0),
      // Unassigned bookings (WITH_OPERATOR but no operator assigned)
      prisma.booking.count({
        where: {
          status: { not: 'CANCELLED' },
          operationMode: 'WITH_OPERATOR',
          operatorId: null,
          ...(hasDateFilter ? { date: dateFilter } : {}),
        },
      }).catch(() => 0),
      // Operator summary
      prisma.booking.groupBy({
        by: ['operatorId'],
        _count: { _all: true },
        where: {
          status: { not: 'CANCELLED' },
          operatorId: { not: null },
          ...(hasDateFilter ? { date: dateFilter } : {}),
        },
      }).then(async (results) => {
        if (results.length === 0) return [];
        const operatorIds = results.map(r => r.operatorId).filter(Boolean) as string[];
        const operators = await prisma.user.findMany({
          where: { id: { in: operatorIds } },
          select: { id: true, name: true },
        });
        const nameMap = new Map(operators.map(o => [o.id, o.name]));
        return results.map(r => ({
          id: r.operatorId!,
          name: nameMap.get(r.operatorId!) || null,
          bookings: r._count._all,
        }));
      }).catch(() => []),
    ]);

    return NextResponse.json({
      totalBookings,
      activeAdmins,
      todayBookings,
      upcomingBookings,
      lastMonthBookings,
      totalSlots,
      totalRevenue: bookingRevenueValue + packageRevenueValue,
      bookingRevenue: bookingRevenueValue,
      packageRevenue: packageRevenueValue,
      totalDiscount: totalDiscountValue,
      machineRevenue,
      selfOperatedBookings,
      unassignedBookings,
      operatorSummary,
      systemStatus: 'Healthy',
    }, {
      headers: {
        'Cache-Control': 'private, s-maxage=30, stale-while-revalidate=60',
      },
    });
  } catch (error) {
    console.error('Admin stats fetch error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
