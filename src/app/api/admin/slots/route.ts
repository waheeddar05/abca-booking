import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/adminAuth';
import { startOfDay, endOfDay, parseISO } from 'date-fns';

export async function GET(req: NextRequest) {
  try {
    const session = await requireAdmin(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const date = searchParams.get('date');
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const activeOnly = searchParams.get('activeOnly') === 'true';

    const where: any = {};

    if (date) {
      where.date = new Date(date);
    } else if (from && to) {
      where.date = {
        gte: startOfDay(parseISO(from)),
        lte: endOfDay(parseISO(to)),
      };
    }

    if (activeOnly) {
      where.isActive = true;
    }

    const slots = await prisma.slot.findMany({
      where,
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    });

    // For each slot, check if it has an active booking
    const slotDates = slots.map(s => s.date);
    const bookings = await prisma.booking.findMany({
      where: {
        date: { in: slotDates },
        status: 'BOOKED',
      },
      select: {
        date: true,
        startTime: true,
        ballType: true,
        playerName: true,
        user: { select: { name: true, email: true } },
      },
    });

    const slotsWithBookingInfo = slots.map(slot => {
      const slotBookings = bookings.filter(
        b => b.startTime.getTime() === slot.startTime.getTime()
      );
      return {
        ...slot,
        isBooked: slotBookings.length > 0,
        bookings: slotBookings,
      };
    });

    return NextResponse.json(slotsWithBookingInfo);
  } catch (error) {
    console.error('Admin slots fetch error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAdmin(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { date, startTime, endTime, price = 600 } = await req.json();

    if (!date || !startTime || !endTime) {
      return NextResponse.json({ error: 'Date, startTime, and endTime are required' }, { status: 400 });
    }

    const slotDate = parseISO(date);
    const start = new Date(startTime);
    const end = new Date(endTime);

    if (start >= end) {
      return NextResponse.json({ error: 'Start time must be before end time' }, { status: 400 });
    }

    // Check for overlapping slots
    const existing = await prisma.slot.findFirst({
      where: {
        date: startOfDay(slotDate),
        startTime: start,
      },
    });

    if (existing) {
      return NextResponse.json({ error: 'A slot already exists at this time' }, { status: 409 });
    }

    const slot = await prisma.slot.create({
      data: {
        date: startOfDay(slotDate),
        startTime: start,
        endTime: end,
        price: Number(price),
      },
    });

    return NextResponse.json(slot, { status: 201 });
  } catch (error) {
    console.error('Admin slot create error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireAdmin(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { slotId, price, isActive } = await req.json();

    if (!slotId) {
      return NextResponse.json({ error: 'Slot ID is required' }, { status: 400 });
    }

    const slot = await prisma.slot.findUnique({ where: { id: slotId } });
    if (!slot) {
      return NextResponse.json({ error: 'Slot not found' }, { status: 404 });
    }

    // Check if slot has active booking - prevent price edit if booked
    const hasBooking = await prisma.booking.findFirst({
      where: {
        date: slot.date,
        startTime: slot.startTime,
        status: 'BOOKED',
      },
    });

    if (hasBooking && price !== undefined && price !== slot.price) {
      return NextResponse.json(
        { error: 'Cannot change price of a slot that is already booked' },
        { status: 400 }
      );
    }

    const data: any = {};
    if (price !== undefined) data.price = Number(price);
    if (isActive !== undefined) data.isActive = Boolean(isActive);

    const updated = await prisma.slot.update({
      where: { id: slotId },
      data,
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Admin slot update error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await requireAdmin(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const slotId = searchParams.get('id');

    if (!slotId) {
      return NextResponse.json({ error: 'Slot ID is required' }, { status: 400 });
    }

    const slot = await prisma.slot.findUnique({ where: { id: slotId } });
    if (!slot) {
      return NextResponse.json({ error: 'Slot not found' }, { status: 404 });
    }

    // Prevent deleting booked slots
    const hasBooking = await prisma.booking.findFirst({
      where: {
        date: slot.date,
        startTime: slot.startTime,
        status: 'BOOKED',
      },
    });

    if (hasBooking) {
      return NextResponse.json(
        { error: 'Cannot delete a slot that has an active booking' },
        { status: 400 }
      );
    }

    await prisma.slot.delete({ where: { id: slotId } });

    return NextResponse.json({ message: 'Slot deleted successfully' });
  } catch (error) {
    console.error('Admin slot delete error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
