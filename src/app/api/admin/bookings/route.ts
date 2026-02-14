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

    const body = await req.json();
    const { bookingId, status, price } = body;

    if (!bookingId) {
      return NextResponse.json({ error: 'Booking ID is required' }, { status: 400 });
    }

    const data: any = {};

    // Handle status update
    if (status) {
      if (!['BOOKED', 'CANCELLED'].includes(status)) {
        return NextResponse.json({ error: 'Invalid status. Use BOOKED or CANCELLED.' }, { status: 400 });
      }
      data.status = status;
    }

    // Handle price update
    if (price !== undefined && price !== null) {
      const numPrice = Number(price);
      if (isNaN(numPrice) || numPrice < 0) {
        return NextResponse.json({ error: 'Invalid price value' }, { status: 400 });
      }
      data.price = numPrice;
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const booking = await prisma.booking.update({
      where: { id: bookingId },
      data,
      select: { id: true, status: true, price: true },
    });

    return NextResponse.json(booking);
  } catch (error: any) {
    console.error('Admin booking update error:', error);
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}

// POST: Copy booking to next consecutive slot
export async function POST(req: NextRequest) {
  try {
    const session = await requireAdmin(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { bookingId, action } = await req.json();

    if (!bookingId || !action) {
      return NextResponse.json({ error: 'Booking ID and action are required' }, { status: 400 });
    }

    if (action === 'copy_next_slot') {
      // Find the source booking
      const sourceBooking = await prisma.booking.findUnique({
        where: { id: bookingId },
      });

      if (!sourceBooking) {
        return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
      }

      // Calculate next slot time (30 min after current endTime)
      const nextStartTime = new Date(sourceBooking.endTime);
      const nextEndTime = new Date(nextStartTime.getTime() + 30 * 60 * 1000);

      // Check if slot is already booked
      const existing = await prisma.booking.findFirst({
        where: {
          date: sourceBooking.date,
          startTime: nextStartTime,
          ballType: sourceBooking.ballType,
          pitchType: sourceBooking.pitchType,
          status: 'BOOKED',
        },
      });

      if (existing) {
        return NextResponse.json({ error: 'Next slot is already booked' }, { status: 409 });
      }

      // Apply consecutive pricing if available
      let newPrice = sourceBooking.price;
      try {
        const { getPricingConfig, getTimeSlabConfig, calculateNewPricing } = await import('@/lib/pricing');
        const [pricingConfig, timeSlabConfig] = await Promise.all([
          getPricingConfig(),
          getTimeSlabConfig(),
        ]);

        const isMachineA = ['LEATHER', 'MACHINE'].includes(sourceBooking.ballType);
        const category: 'MACHINE' | 'TENNIS' = isMachineA ? 'MACHINE' : 'TENNIS';

        // Calculate consecutive pricing for 2 slots
        const pricing = calculateNewPricing(
          [
            { startTime: sourceBooking.startTime, endTime: sourceBooking.endTime },
            { startTime: nextStartTime, endTime: nextEndTime },
          ],
          category,
          sourceBooking.ballType as any,
          sourceBooking.pitchType as any,
          timeSlabConfig,
          pricingConfig
        );

        if (pricing[1]) {
          newPrice = pricing[1].price;
        }
      } catch {
        // fallback: keep same price
      }

      const newBooking = await prisma.booking.create({
        data: {
          userId: sourceBooking.userId,
          date: sourceBooking.date,
          startTime: nextStartTime,
          endTime: nextEndTime,
          status: 'BOOKED',
          ballType: sourceBooking.ballType,
          pitchType: sourceBooking.pitchType,
          playerName: sourceBooking.playerName,
          operationMode: sourceBooking.operationMode,
          price: newPrice,
          originalPrice: sourceBooking.originalPrice,
        },
      });

      return NextResponse.json(newBooking);
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error: any) {
    console.error('Admin booking action error:', error);
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}
