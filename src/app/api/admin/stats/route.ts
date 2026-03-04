import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/adminAuth';
import { getISTTodayUTC, getISTLastMonthRange } from '@/lib/time';

export async function GET(req: NextRequest) {
  try {
    const session = await requireAdmin(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

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
      totalRevenueValue,
      totalDiscountValue,
    ] = await Promise.all([
      prisma.booking.count({
        where: { status: { not: 'CANCELLED' } },
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
      prisma.booking.aggregate({
        _sum: { price: true },
        where: { status: { in: ['BOOKED', 'DONE'] }, isSuperAdminBooking: false },
      }).then(r => r._sum.price || 0).catch(() => 0),
      prisma.booking.aggregate({
        _sum: { discountAmount: true },
        where: {
          status: { in: ['BOOKED', 'DONE'] },
          isSuperAdminBooking: false,
          discountAmount: { gt: 0 },
        },
      }).then(r => r._sum.discountAmount || 0).catch(() => 0),
    ]);

    return NextResponse.json({
      totalBookings,
      activeAdmins,
      todayBookings,
      upcomingBookings,
      lastMonthBookings,
      totalSlots,
      totalRevenue: totalRevenueValue,
      totalDiscount: totalDiscountValue,
      systemStatus: 'Healthy',
    }, {
      headers: {
        'Cache-Control': 'private, s-maxage=30, stale-while-revalidate=60',
      },
    });
  } catch (error: any) {
    console.error('Admin stats fetch error:', error);
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}
