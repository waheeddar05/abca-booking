import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/adminAuth';
import { getISTTodayUTC, getISTLastMonthRange, dateStringToUTC } from '@/lib/time';

const SAFE_BOOKING_SELECT = {
  id: true,
  userId: true,
  date: true,
  startTime: true,
  endTime: true,
  status: true,
  ballType: true,
  playerName: true,
  createdAt: true,
  user: { select: { name: true, email: true, mobileNumber: true } },
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
    const customer = searchParams.get('customer');
    const userId = searchParams.get('userId');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const sortBy = searchParams.get('sortBy') || 'date';
    const sortOrder = searchParams.get('sortOrder') || 'desc';

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

    if (customer) {
      where.OR = [
        { playerName: { contains: customer, mode: 'insensitive' } },
        { user: { name: { contains: customer, mode: 'insensitive' } } },
        { user: { email: { contains: customer, mode: 'insensitive' } } },
      ];
    }

    if (userId) {
      where.userId = userId;
    }

    const orderBy: any = [];
    if (sortBy === 'createdAt') {
      orderBy.push({ createdAt: sortOrder });
    } else {
      orderBy.push({ date: sortOrder });
      orderBy.push({ startTime: sortOrder });
    }

    const skip = (page - 1) * limit;

    // Try full query; fall back to safe select if new columns don't exist yet
    let bookings: any[];
    let total: number;
    try {
      [bookings, total] = await Promise.all([
        prisma.booking.findMany({
          where,
          include: { user: { select: { name: true, email: true, mobileNumber: true } } },
          orderBy,
          skip,
          take: limit,
        }),
        prisma.booking.count({ where }),
      ]);
    } catch {
      [bookings, total] = await Promise.all([
        prisma.booking.findMany({
          where,
          select: SAFE_BOOKING_SELECT,
          orderBy,
          skip,
          take: limit,
        }),
        prisma.booking.count({ where }),
      ]);
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { status: _statusFilter, ...whereWithoutStatus } = where;
    const [bookedCount, doneCount, cancelledCount] = await Promise.all([
      prisma.booking.count({ where: { ...whereWithoutStatus, status: 'BOOKED' } }),
      prisma.booking.count({ where: { ...whereWithoutStatus, status: 'DONE' } }),
      prisma.booking.count({ where: { ...whereWithoutStatus, status: 'CANCELLED' } }),
    ]);

    return NextResponse.json({
      bookings,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      summary: {
        booked: bookedCount,
        done: doneCount,
        cancelled: cancelledCount,
        total: bookedCount + doneCount + cancelledCount,
      },
    });
  } catch (error: any) {
    console.error('Admin bookings fetch error:', error);
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireAdmin(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { bookingId, status } = await req.json();

    if (!bookingId || !status) {
      return NextResponse.json({ error: 'Booking ID and status are required' }, { status: 400 });
    }

    if (!['BOOKED', 'CANCELLED', 'DONE'].includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    // update only touches 'status' column, safe regardless of migration state
    const booking = await prisma.booking.update({
      where: { id: bookingId },
      data: { status },
      select: { id: true, status: true },
    });

    return NextResponse.json(booking);
  } catch (error: any) {
    console.error('Admin booking update error:', error);
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}
