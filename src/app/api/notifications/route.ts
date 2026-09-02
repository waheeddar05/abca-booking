import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser, canAccessCenter } from '@/lib/auth';
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
    // Who booked each linked booking. Staff and center-wide role
    // subscribers get alerts about OTHER people's bookings, and the card
    // has to render differently for them: a customer-facing card hides
    // the booker's phone (the one thing floor staff need) and, being a
    // snapshot of the first row, drops the batch window/total that the
    // message text carries. `isOwnBooking` lets the client pick.
    // Best-effort — a failure just renders every card as the viewer's own.
    const [cards, owners] = await Promise.all([
      loadBookingCards(bookingIds),
      bookingIds.length > 0
        ? prisma.booking
            .findMany({ where: { id: { in: bookingIds } }, select: { id: true, userId: true } })
            .catch(() => [] as { id: string; userId: string | null }[])
        : Promise.resolve([] as { id: string; userId: string | null }[]),
    ]);
    const ownerById = new Map(owners.map((b) => [b.id, b.userId]));

    const withBookings = notifications.map((n) => {
      const bookingId = (n as { bookingId?: string | null }).bookingId ?? null;
      const card = bookingId ? cards.get(bookingId) ?? null : null;
      const isOwnBooking = bookingId ? (ownerById.get(bookingId) ?? user.id) === user.id : true;
      // The card is re-read on every fetch, so it is a LIVE view of the
      // booking, not the frozen snapshot the message text is. For someone
      // else's booking that has to be re-authorised each time: a staff
      // member or role subscriber whose membership has since been revoked
      // would otherwise keep watching that booking's current status,
      // price, refund and assignments forever, through an alert they were
      // legitimately sent months ago. Dropping the card leaves the
      // historical message text, which is what staff alerts showed before
      // they carried a bookingId at all.
      const maySeeCard =
        isOwnBooking || (!!card?.centerId && canAccessCenter(user, card.centerId));
      return {
        ...n,
        booking: maySeeCard ? card : null,
        isOwnBooking,
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
