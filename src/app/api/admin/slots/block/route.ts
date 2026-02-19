import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';
import { dateStringToUTC } from '@/lib/time';

// GET /api/admin/slots/block - List blocked slots
export async function GET(req: NextRequest) {
  try {
    const admin = await getAuthenticatedUser(req);
    if (!admin || admin.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const includeExpired = searchParams.get('includeExpired') === 'true';

    const where: any = {};
    if (!includeExpired) {
      // Only show blocks whose endDate is today or in the future
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      where.endDate = { gte: today };
    }

    const blockedSlots = await prisma.blockedSlot.findMany({
      where,
      orderBy: { startDate: 'desc' },
    });

    return NextResponse.json(blockedSlots);
  } catch (error) {
    console.error('Get blocked slots error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/admin/slots/block - Block slots
export async function POST(req: NextRequest) {
  try {
    const admin = await getAuthenticatedUser(req);

    if (!admin || admin.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const {
      startDate,
      endDate,
      startTime, // "HH:mm" or null
      endTime,   // "HH:mm" or null
      machineType,
      pitchType,
      reason
    } = await req.json();

    if (!startDate || !endDate) {
      return NextResponse.json({ error: 'Start date and end date are required' }, { status: 400 });
    }

    const start = dateStringToUTC(startDate);
    const end = dateStringToUTC(endDate);

    let startT: Date | null = null;
    let endT: Date | null = null;

    if (startTime && endTime) {
      // Create representative dates for time range blocking
      startT = new Date(`1970-01-01T${startTime}:00+05:30`);
      endT = new Date(`1970-01-01T${endTime}:00+05:30`);
    }

    // 1. Create the BlockedSlot record
    const blockedSlot = await prisma.blockedSlot.create({
      data: {
        startDate: start,
        endDate: end,
        startTime: startT,
        endTime: endT,
        machineType,
        pitchType,
        reason,
        blockedBy: admin.id,
      },
    });

    // 2. Find and cancel conflicting bookings
    const where: any = {
      date: {
        gte: start,
        lte: end,
      },
      status: 'BOOKED',
    };

    if (machineType) {
      // In this system, ballType determines the machine
      // MACHINE_A_BALLS: ['LEATHER', 'MACHINE']
      // MACHINE_B_BALLS: ['TENNIS']
      if (machineType === 'LEATHER' || machineType === 'MACHINE') {
        where.ballType = { in: ['LEATHER', 'MACHINE'] };
      } else {
        where.ballType = 'TENNIS';
      }
    }

    if (pitchType) {
      where.pitchType = pitchType;
    }

    const conflictingBookings = await prisma.booking.findMany({
      where,
    });

    const bookingsToCancel = conflictingBookings.filter(booking => {
      // If full day block (startTime is null), all on this date are conflicting
      if (!startT || !endT) return true;

      // Robust time range overlap check using minutes from midnight
      const getMinutes = (d: Date) => d.getUTCHours() * 60 + d.getUTCMinutes();

      const blockStartMin = getMinutes(startT);
      const blockEndMin = getMinutes(endT);

      const bookingStartMin = getMinutes(new Date(booking.startTime));
      const bookingEndMin = getMinutes(new Date(booking.endTime));

      // Overlap check
      return bookingStartMin < blockEndMin && bookingEndMin > blockStartMin;
    });

    if (bookingsToCancel.length > 0) {
      const displayReason = `Cancelled by Admin - ${reason || 'Maintenance'}`;
      const cancelledByName = `Admin (${admin.name || admin.id})`;

      await prisma.$transaction([
        ...bookingsToCancel.map(booking =>
          prisma.booking.update({
            where: { id: booking.id },
            data: {
              status: 'CANCELLED',
              cancelledBy: cancelledByName,
              cancellationReason: displayReason,
            }
          })
        ),
        ...bookingsToCancel.filter(b => b.userId).map(booking =>
          prisma.notification.create({
            data: {
              userId: booking.userId as string,
              title: 'Booking Cancelled by Admin',
              message: displayReason,
              type: 'ALERT',
            }
          })
        )
      ]);

      // Restore package sessions for cancelled bookings
      for (const booking of bookingsToCancel) {
        const pb = await prisma.packageBooking.findUnique({
          where: { bookingId: booking.id }
        });
        if (pb) {
          await prisma.userPackage.update({
            where: { id: pb.userPackageId },
            data: { usedSessions: { decrement: pb.sessionsUsed } }
          });
        }
      }
    }

    return NextResponse.json({
      message: 'Slots blocked successfully',
      blockedSlot,
      cancelledBookingsCount: bookingsToCancel.length
    });

  } catch (error) {
    console.error('Block slots error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/admin/slots/block?id=xxx - Remove a blocked slot
export async function DELETE(req: NextRequest) {
  try {
    const admin = await getAuthenticatedUser(req);
    if (!admin || admin.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Blocked slot id is required' }, { status: 400 });
    }

    const blockedSlot = await prisma.blockedSlot.findUnique({ where: { id } });
    if (!blockedSlot) {
      return NextResponse.json({ error: 'Blocked slot not found' }, { status: 404 });
    }

    await prisma.blockedSlot.delete({ where: { id } });

    return NextResponse.json({ message: 'Block removed successfully' });
  } catch (error) {
    console.error('Delete blocked slot error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
