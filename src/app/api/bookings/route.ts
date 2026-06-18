import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';
import { resolveCurrentCenter } from '@/lib/centers';
import { sanitizeApiError } from '@/lib/api-errors';
import { BOOKING_CARD_INCLUDE, mapBookingForCard } from '@/lib/booking-card';

// Safe select: only columns guaranteed to exist (pre-migration)
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
} as const;

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = user.id;
    const { searchParams } = new URL(req.url);
    const tab = searchParams.get('tab'); // all, upcoming, inProgress, completed, cancelled
    const allCenters = searchParams.get('allCenters') === 'true';
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const skip = (page - 1) * limit;

    // Filter by current center by default, matching the multi-center "each
    // center is independent" model. Pass `?allCenters=true` to see history
    // across every center the user has booked at.
    const where: any = { userId };
    if (!allCenters) {
      const center = await resolveCurrentCenter(req, user);
      if (center) where.centerId = center.id;
    }
    const now = new Date();

    if (tab === 'upcoming') {
      where.status = 'BOOKED';
      where.startTime = { gt: now };
    } else if (tab === 'inProgress') {
      where.status = 'BOOKED';
      where.startTime = { lte: now };
      where.endTime = { gt: now };
    } else if (tab === 'completed') {
      where.OR = [
        { status: 'DONE' },
        { status: 'BOOKED', endTime: { lte: now } },
      ];
    } else if (tab === 'cancelled') {
      where.status = 'CANCELLED';
    }

    // Pre-payment HOLD rows (reserve-then-confirm) are not real bookings —
    // never surface them in the user's history. The 'all' tab sets no status
    // filter, so exclude HOLD explicitly there.
    if (where.status === undefined && where.OR === undefined) {
      where.status = { not: 'HOLD' };
    }

    // Try full query first; if new columns don't exist, fall back to safe select
    let bookings: any[];
    let total: number;
    try {
      [bookings, total] = await Promise.all([
        prisma.booking.findMany({
          where,
          orderBy: { startTime: 'desc' },
          skip,
          take: limit,
          // Shared with the in-app Alerts view so both render the same
          // booking snapshot. See src/lib/booking-card.ts.
          include: BOOKING_CARD_INCLUDE,
        }),
        prisma.booking.count({ where }),
      ]);
    } catch {
      [bookings, total] = await Promise.all([
        prisma.booking.findMany({
          where,
          orderBy: { startTime: 'desc' },
          select: SAFE_BOOKING_SELECT,
          skip,
          take: limit,
        }),
        prisma.booking.count({ where }),
      ]);
    }

    // Check if any booking has a package booking
    const bookingIds = bookings.map((b: any) => b.id);
    let packageBookings: any[] = [];
    try {
      packageBookings = await prisma.packageBooking.findMany({
        where: { bookingId: { in: bookingIds } },
        select: { bookingId: true },
      });
    } catch {
      // ignore if table doesn't exist
    }
    const packageBookingSet = new Set(packageBookings.map((pb: any) => pb.bookingId));

    // Fetch refund info for all bookings from the Refund table
    let refundMap: Record<string, { method: string; totalRefunded: number; refunds: Array<{ method: string; amount: number; status: string; refundedAt: string }> }> = {};
    if (bookingIds.length > 0) {
      try {
        const refunds = await prisma.refund.findMany({
          where: {
            bookingId: { in: bookingIds },
            status: { not: 'FAILED' },
          },
          select: {
            bookingId: true,
            amount: true,
            method: true,
            status: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        });
        for (const r of refunds) {
          if (!refundMap[r.bookingId]) {
            refundMap[r.bookingId] = { method: r.method, totalRefunded: 0, refunds: [] };
          }
          refundMap[r.bookingId].totalRefunded += r.amount;
          refundMap[r.bookingId].refunds.push({
            method: r.method,
            amount: r.amount,
            status: r.status,
            refundedAt: r.createdAt.toISOString(),
          });
        }
      } catch {
        // ignore if table doesn't exist yet
      }
    }

    const mappedBookings = bookings.map((b: any) =>
      mapBookingForCard(b, {
        refund: refundMap[b.id]
          ? {
              method: refundMap[b.id].method,
              amount: refundMap[b.id].totalRefunded,
              refundedAt: refundMap[b.id].refunds[0]?.refundedAt || null,
              refunds: refundMap[b.id].refunds,
            }
          : null,
        isPackageBooking: packageBookingSet.has(b.id),
      }),
    );

    return NextResponse.json({
      bookings: mappedBookings,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    const { message, status } = sanitizeApiError(
      error,
      'bookings.list',
      'Could not load bookings. Please try again.',
    );
    return NextResponse.json({ error: message }, { status });
  }
}
