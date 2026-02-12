import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/adminAuth';
import { getISTTodayUTC, getISTLastMonthRange, dateStringToUTC, formatIST } from '@/lib/time';

const SAFE_BOOKING_SELECT = {
  id: true,
  date: true,
  startTime: true,
  endTime: true,
  status: true,
  ballType: true,
  playerName: true,
  createdAt: true,
  user: { select: { email: true, mobileNumber: true } },
} as const;

export async function GET(req: NextRequest) {
  try {
    const session = await requireAdmin(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const category = searchParams.get('category');
    const date = searchParams.get('date');
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const status = searchParams.get('status');

    const where: any = {};
    const todayUTC = getISTTodayUTC();

    if (category === 'today') {
      where.date = todayUTC;
    } else if (category === 'upcoming') {
      where.date = { gt: todayUTC };
      where.status = 'BOOKED';
    } else if (category === 'previous') {
      where.date = { lt: todayUTC };
    } else if (category === 'lastMonth') {
      const lastMonthRange = getISTLastMonthRange();
      where.date = {
        gte: lastMonthRange.start,
        lte: lastMonthRange.end,
      };
    }

    if (date) {
      where.date = dateStringToUTC(date);
    } else if (from && to) {
      where.date = {
        gte: dateStringToUTC(from),
        lte: dateStringToUTC(to),
      };
    }

    if (status) {
      where.status = status;
    }

    // Try full query; fall back to safe select if new columns don't exist yet
    let bookings: any[];
    try {
      bookings = await prisma.booking.findMany({
        where,
        include: { user: { select: { email: true, mobileNumber: true } } },
        orderBy: [{ date: 'desc' }, { startTime: 'asc' }],
      });
    } catch {
      bookings = await prisma.booking.findMany({
        where,
        select: SAFE_BOOKING_SELECT,
        orderBy: [{ date: 'desc' }, { startTime: 'asc' }],
      });
    }

    // Build CSV
    const headers = [
      'Booking ID',
      'Date',
      'Start Time',
      'End Time',
      'Player Name',
      'User Email',
      'User Mobile',
      'Ball Type',
      'Pitch Type',
      'Status',
      'Price',
      'Extra Charge',
      'Discount',
      'Created At',
    ];

    const rows = bookings.map((b: any) => [
      b.id,
      formatIST(b.date, 'yyyy-MM-dd'),
      formatIST(b.startTime, 'HH:mm'),
      formatIST(b.endTime, 'HH:mm'),
      `"${b.playerName.replace(/"/g, '""')}"`,
      b.user?.email || '',
      b.user?.mobileNumber || '',
      b.ballType,
      b.pitchType || '',
      b.status,
      b.price?.toString() || '',
      b.extraCharge?.toString() || '',
      b.discountAmount?.toString() || '',
      formatIST(b.createdAt, 'yyyy-MM-dd HH:mm:ss'),
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

    const now = new Date();
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename=bookings-export-${formatIST(now, 'yyyy-MM-dd')}.csv`,
      },
    });
  } catch (error: any) {
    console.error('Admin bookings export error:', error);
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}
