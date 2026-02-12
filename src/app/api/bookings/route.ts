import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';

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

    // Try full query first; if new columns don't exist, fall back to safe select
    let bookings: any[];
    try {
      bookings = await prisma.booking.findMany({
        where: { userId },
        orderBy: { startTime: 'desc' },
      });
    } catch {
      bookings = await prisma.booking.findMany({
        where: { userId },
        orderBy: { startTime: 'desc' },
        select: SAFE_BOOKING_SELECT,
      });
    }

    const mappedBookings = bookings.map((b: any) => ({
      id: b.id,
      date: b.date.toISOString(),
      startTime: b.startTime.toISOString(),
      endTime: b.endTime.toISOString(),
      ballType: b.ballType,
      playerName: b.playerName,
      status: b.status,
      price: b.price ?? null,
      originalPrice: b.originalPrice ?? null,
      discountAmount: b.discountAmount ?? null,
      discountType: b.discountType ?? null,
      pitchType: b.pitchType ?? null,
      extraCharge: b.extraCharge ?? null,
    }));

    return NextResponse.json(mappedBookings);
  } catch (error: any) {
    console.error('Fetch bookings error:', error);
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}
