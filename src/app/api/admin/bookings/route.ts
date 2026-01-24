import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getToken } from 'next-auth/jwt';
import { verifyToken } from '@/lib/jwt';

async function getSession(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (token) return { role: token.role, email: token.email };

  const otpTokenStr = req.cookies.get('token')?.value;
  if (otpTokenStr) {
    const otpToken = verifyToken(otpTokenStr) as any;
    return { role: otpToken?.role, email: otpToken?.email };
  }
  return null;
}

export async function GET(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (session?.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const date = searchParams.get('date');
    const status = searchParams.get('status');
    const customer = searchParams.get('customer');

    const where: any = {};
    if (date) {
      where.date = new Date(date);
    }
    if (status) {
      where.status = status;
    }
    if (customer) {
      where.OR = [
        { playerName: { contains: customer, mode: 'insensitive' } },
        { user: { name: { contains: customer, mode: 'insensitive' } } },
        { user: { email: { contains: customer, mode: 'insensitive' } } },
      ];
    }

    const bookings = await prisma.booking.findMany({
      where,
      include: {
        user: {
          select: {
            name: true,
            email: true,
            mobileNumber: true,
          },
        },
      },
      orderBy: {
        startTime: 'desc',
      },
    });

    return NextResponse.json(bookings);
  } catch (error) {
    console.error('Admin bookings fetch error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
