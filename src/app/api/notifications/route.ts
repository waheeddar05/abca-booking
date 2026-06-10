import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';
import { loadBookingCards } from '@/lib/booking-card';

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const notifications = await prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    // Attach a full Bookings-page card snapshot to every booking-linked
    // alert so the Alerts view can render the same detail the My Bookings
    // page shows — without the user having to open the booking. Batched
    // into one lookup; best-effort (a missing/deleted booking just yields
    // no snapshot, and any failure leaves notifications rendering as text).
    const bookingIds = notifications
      .map((n) => (n as { bookingId?: string | null }).bookingId)
      .filter((id): id is string => !!id);
    const cards = await loadBookingCards(bookingIds);

    const withBookings = notifications.map((n) => {
      const bookingId = (n as { bookingId?: string | null }).bookingId ?? null;
      return {
        ...n,
        booking: bookingId ? cards.get(bookingId) ?? null : null,
      };
    });

    return NextResponse.json(withBookings);
  } catch (error) {
    console.error('Fetch notifications error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id, isRead } = await req.json();

    if (id) {
      // Mark specific notification as read
      await prisma.notification.update({
        where: { id, userId: user.id },
        data: { isRead: isRead ?? true },
      });
    } else {
      // Mark all as read
      await prisma.notification.updateMany({
        where: { userId: user.id, isRead: false },
        data: { isRead: true },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Update notifications error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
