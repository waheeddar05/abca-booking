import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';
import { getISTTime } from '@/lib/time';
import { isBefore } from 'date-fns';

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = user.id;

    const { bookingId } = await req.json();

    if (!bookingId) {
      return NextResponse.json({ error: 'Booking ID is required' }, { status: 400 });
    }

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
    });

    if (!booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }

    if (booking.userId !== userId && user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // User side: Users should NOT be able to cancel sessions that are already in the past
    if (user.role !== 'ADMIN') {
      const now = getISTTime();
      if (isBefore(booking.startTime, now)) {
        return NextResponse.json({ error: 'Cannot cancel past sessions' }, { status: 400 });
      }
    }

    await prisma.booking.update({
      where: { id: bookingId },
      data: { 
        status: 'CANCELLED',
        cancelledBy: user.name || user.id,
        cancellationReason: user.role === 'ADMIN' ? `Cancelled by Admin (${user.name || user.id})` : `Cancelled by User (${user.name || user.id})`,
      },
    });

    // Restore package session if this was a package booking
    const packageBooking = await prisma.packageBooking.findUnique({
      where: { bookingId },
    });

    if (packageBooking) {
      await prisma.userPackage.update({
        where: { id: packageBooking.userPackageId },
        data: {
          usedSessions: { decrement: packageBooking.sessionsUsed },
        },
      });
    }

    return NextResponse.json({ message: 'Booking cancelled' });
  } catch (error) {
    console.error('Cancel booking error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
