import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getToken } from 'next-auth/jwt';
import { verifyToken } from '@/lib/jwt';

async function getSession(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (token) return { role: token.role, email: token.email };

  const otpTokenStr = req.cookies.get('token')?.value;
  if (otpTokenStr) {
    try {
      const otpToken = verifyToken(otpTokenStr) as any;
      return { role: otpToken?.role, email: otpToken?.email };
    } catch (e) {
      return null;
    }
  }
  return null;
}

export async function GET(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (session?.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const [totalBookings, activeAdmins] = await Promise.all([
      prisma.booking.count(),
      prisma.user.count({
        where: { role: 'ADMIN' },
      }),
    ]);

    return NextResponse.json({
      totalBookings,
      activeAdmins,
      systemStatus: 'Healthy',
    });
  } catch (error) {
    console.error('Admin stats fetch error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
