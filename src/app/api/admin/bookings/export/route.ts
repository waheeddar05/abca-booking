import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/adminAuth';
import { getISTTodayUTC, getISTLastMonthRange, dateStringToUTC, formatIST } from '@/lib/time';

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
      'Pitch Type',
      'Status',
      'Price',
      'Extra Charge',
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
      (b as any).pitchType || '',
      b.status,
      b.price?.toString() || '',
      (b as any).extraCharge?.toString() || '',
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
  } catch (error) {
    console.error('Admin bookings export error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
