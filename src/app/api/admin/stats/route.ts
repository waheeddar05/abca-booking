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

    const [
      totalBookings,
      activeAdmins,
      todayBookings,
      upcomingBookings,
      lastMonthBookings,
    ] = await Promise.all([
      prisma.booking.count(),
      prisma.user.count({ where: { role: 'ADMIN' } }),
      prisma.booking.count({
        where: { date: todayUTC },
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
        },
      }),
    ]);

    // These queries depend on post-migration schema (Slot table, price/discountAmount columns)
    let totalSlots = 0;
    let totalRevenueValue = 0;
    let totalDiscountValue = 0;
    try {
      [totalSlots, totalRevenueValue, totalDiscountValue] = await Promise.all([
        prisma.slot.count(),
        prisma.booking.aggregate({
          _sum: { price: true },
          where: { status: { in: ['BOOKED', 'DONE'] } },
        }).then(r => r._sum.price || 0),
        prisma.booking.aggregate({
          _sum: { discountAmount: true },
          where: {
            status: { in: ['BOOKED', 'DONE'] },
            discountAmount: { gt: 0 },
          },
        }).then(r => r._sum.discountAmount || 0),
      ]);
    } catch {
      // Slot table or pricing columns may not exist if migrations haven't been applied
    }

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
    });
  } catch (error: any) {
    console.error('Admin stats fetch error:', error);
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}
