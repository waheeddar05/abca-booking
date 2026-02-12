import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/adminAuth';
import { startOfDay, endOfDay, subMonths, startOfMonth, endOfMonth } from 'date-fns';
import { toDate } from 'date-fns-tz';
import { TIMEZONE } from '@/lib/time';

export async function GET(req: NextRequest) {
  try {
    const session = await requireAdmin(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const now = toDate(new Date(), { timeZone: TIMEZONE });
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);
    const lastMonth = subMonths(now, 1);

    const [
      totalBookings,
      activeAdmins,
      todayBookings,
      upcomingBookings,
      lastMonthBookings,
      totalSlots,
      totalRevenue,
      totalDiscount,
    ] = await Promise.all([
      prisma.booking.count(),
      prisma.user.count({ where: { role: 'ADMIN' } }),
      prisma.booking.count({
        where: { date: { gte: todayStart, lte: todayEnd } },
      }),
      prisma.booking.count({
        where: { date: { gt: todayEnd }, status: 'BOOKED' },
      }),
      prisma.booking.count({
        where: {
          date: {
            gte: startOfMonth(lastMonth),
            lte: endOfMonth(lastMonth),
          },
        },
      }),
      prisma.slot.count(),
      prisma.booking.aggregate({
        _sum: { price: true },
        where: { status: { in: ['BOOKED', 'DONE'] } },
      }),
      prisma.booking.aggregate({
        _sum: { discountAmount: true },
        where: {
          status: { in: ['BOOKED', 'DONE'] },
          discountAmount: { gt: 0 },
        },
      }),
    ]);

    return NextResponse.json({
      totalBookings,
      activeAdmins,
      todayBookings,
      upcomingBookings,
      lastMonthBookings,
      totalSlots,
      totalRevenue: totalRevenue._sum.price || 0,
      totalDiscount: totalDiscount._sum.discountAmount || 0,
      systemStatus: 'Healthy',
    });
  } catch (error) {
    console.error('Admin stats fetch error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
