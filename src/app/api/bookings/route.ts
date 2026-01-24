import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/jwt';
import { getServerSession } from "next-auth/next";

export async function GET(req: NextRequest) {
  try {
    let userId: string | undefined;

    // Check for NextAuth session
    const session = await getServerSession();
    if (session?.user?.email) {
      const dbUser = await prisma.user.findUnique({
        where: { email: session.user.email },
      });
      userId = dbUser?.id;
    }

    // Check for JWT token if no NextAuth session
    if (!userId) {
      const token = req.cookies.get('token')?.value;
      const decoded = token ? (verifyToken(token) as any) : null;
      if (decoded?.userId) {
        userId = decoded.userId;
      }
    }

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const bookings = await prisma.booking.findMany({
      where: {
        userId: userId,
      },
      orderBy: {
        startTime: 'desc',
      },
    });

    // Map to frontend Booking interface if necessary
    const mappedBookings = bookings.map(b => ({
      id: b.id,
      date: b.date.toISOString(),
      startTime: b.startTime.toISOString(),
      endTime: b.endTime.toISOString(),
      ballType: b.ballType,
      playerName: b.playerName,
      status: b.status
    }));

    return NextResponse.json(mappedBookings);
  } catch (error) {
    console.error('Fetch bookings error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
