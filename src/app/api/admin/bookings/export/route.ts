import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/adminAuth';
import { startOfDay, endOfDay, parseISO, subMonths, startOfMonth, endOfMonth } from 'date-fns';
import { toDate } from 'date-fns-tz';
import { TIMEZONE, formatIST } from '@/lib/time';

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
    const now = toDate(new Date(), { timeZone: TIMEZONE });
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);

    if (category === 'today') {
      where.date = { gte: todayStart, lte: todayEnd };
    } else if (category === 'upcoming') {
      where.date = { gt: todayEnd };
      where.status = 'BOOKED';
    } else if (category === 'previous') {
      where.date = { lt: todayStart };
    } else if (category === 'lastMonth') {
      const lastMonth = subMonths(now, 1);
      where.date = {
        gte: startOfMonth(lastMonth),
        lte: endOfMonth(lastMonth),
      };
    }

    if (date) {
      where.date = new Date(date);
    } else if (from && to) {
      where.date = {
        gte: startOfDay(parseISO(from)),
        lte: endOfDay(parseISO(to)),
      };
    }

    if (status) {
      where.status = status;
    }

    const bookings = await prisma.booking.findMany({
      where,
      include: {
        user: {
          select: { name: true, email: true, mobileNumber: true },
        },
      },
      orderBy: [{ date: 'desc' }, { startTime: 'asc' }],
    });

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
      'Status',
      'Price',
      'Discount',
      'Created At',
    ];

    const rows = bookings.map(b => [
      b.id,
      formatIST(b.date, 'yyyy-MM-dd'),
      formatIST(b.startTime, 'HH:mm'),
      formatIST(b.endTime, 'HH:mm'),
      `"${b.playerName.replace(/"/g, '""')}"`,
      b.user?.email || '',
      b.user?.mobileNumber || '',
      b.ballType,
      b.status,
      b.price?.toString() || '',
      b.discountAmount?.toString() || '',
      formatIST(b.createdAt, 'yyyy-MM-dd HH:mm:ss'),
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename=bookings-export-${formatIST(now, 'yyyy-MM-dd')}.csv`,
      },
    });
  } catch (error) {
    console.error('Admin bookings export error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
