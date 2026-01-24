import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/jwt';
import { getServerSession } from "next-auth/next";

export async function POST(req: NextRequest) {
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

    if (booking.userId !== userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await prisma.booking.update({
      where: { id: bookingId },
      data: { status: 'CANCELLED' },
    });

    return NextResponse.json({ message: 'Booking cancelled' });
  } catch (error) {
    console.error('Cancel booking error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
