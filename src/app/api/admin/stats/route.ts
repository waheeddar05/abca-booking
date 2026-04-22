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
      // Booking revenue = Total paid − Total refunded (net retained).
      // Paid side includes BOOKED / DONE / CANCELLED (any booking where payment
      // was collected). Refund side sums processed refunds for those bookings.
      (async () => {
        try {
          const [paidAgg, refundAgg] = await Promise.all([
            prisma.booking.aggregate({
              _sum: { price: true },
              where: {
                isSuperAdminBooking: false,
                ...(hasDateFilter ? { date: dateFilter } : {}),
              },
            }),
            prisma.refund.aggregate({
              _sum: { amount: true },
              where: {
                status: 'PROCESSED',
                booking: {
                  isSuperAdminBooking: false,
                  ...(hasDateFilter ? { date: dateFilter } : {}),
                },
              },
            }),
          ]);
          const paid = paidAgg._sum.price || 0;
          const refunded = refundAgg._sum.amount || 0;
          return Math.max(0, paid - refunded);
        } catch {
          return 0;
        }
      })(),
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
      // Package revenue — net retained across ALL statuses:
      // sum(amountPaid) across every UserPackage minus CREDIT_REFUND txns
      // referenced to those packages (handles partial-refund cancellations).
      (async () => {
        try {
          const ups = await prisma.userPackage.findMany({
            where: hasDateFilter ? { createdAt: dateFilter } : {},
            select: { id: true, amountPaid: true },
          });
          if (ups.length === 0) return 0;
          const refundRows = await prisma.walletTransaction.findMany({
            where: {
              type: 'CREDIT_REFUND',
              referenceId: { in: ups.map(u => u.id) },
            },
            select: { referenceId: true, amount: true },
          });
          const refundById = new Map<string, number>();
          for (const r of refundRows) {
            if (!r.referenceId) continue;
            refundById.set(r.referenceId, (refundById.get(r.referenceId) || 0) + r.amount);
          }
          return ups.reduce(
            (sum, up) => sum + Math.max(0, up.amountPaid - (refundById.get(up.id) || 0)),
            0,
          );
        } catch {
          return 0;
        }
      })(),
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
