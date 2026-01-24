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

    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN' },
      select: {
        id: true,
        name: true,
        email: true,
        mobileNumber: true,
        createdAt: true,
      },
    });

    return NextResponse.json(admins);
  } catch (error) {
    console.error('Admin users fetch error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (session?.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    if (session?.email !== 'waheeddar8@gmail.com') {
      return NextResponse.json(
        { error: 'Only super admin can invite other admins' },
        { status: 403 }
      );
    }

    const { email } = await req.json();

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (user) {
      await prisma.user.update({
        where: { id: user.id },
        data: { role: 'ADMIN' },
      });
    } else {
      await prisma.user.create({
        data: {
          email,
          role: 'ADMIN',
          authProvider: 'GOOGLE', // Default or handle as invited
        },
      });
    }

    return NextResponse.json({ message: 'Admin added successfully' });
  } catch (error) {
    console.error('Admin add error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (session?.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    if (session?.email !== 'waheeddar8@gmail.com') {
      return NextResponse.json(
        { error: 'Only super admin can remove other admins' },
        { status: 403 }
      );
    }

    const { id } = await req.json();

    if (!id) {
      return NextResponse.json({ error: 'Admin ID is required' }, { status: 400 });
    }

    // Prevent removing self
    // We don't have super admin ID here easily without querying, but we can check email if we had user object
    const adminToRemove = await prisma.user.findUnique({ where: { id } });
    if (adminToRemove?.email === 'waheeddar8@gmail.com') {
      return NextResponse.json({ error: 'Cannot remove super admin' }, { status: 400 });
    }

    await prisma.user.update({
      where: { id },
      data: { role: 'USER' },
    });

    return NextResponse.json({ message: 'Admin removed successfully' });
  } catch (error) {
    console.error('Admin remove error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
