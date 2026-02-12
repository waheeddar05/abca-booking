import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = user.id;

    const bookings = await prisma.booking.findMany({
      where: {
        userId: userId,
      },
      orderBy: {
        startTime: 'desc',
      },
    });

    const mappedBookings = bookings.map(b => ({
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
      pitchType: (b as any).pitchType ?? null,
      extraCharge: (b as any).extraCharge ?? null,
    }));

    return NextResponse.json(mappedBookings);
  } catch (error) {
    console.error('Fetch bookings error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
