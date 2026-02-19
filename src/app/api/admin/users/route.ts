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
    const search = searchParams.get('search');
    const role = searchParams.get('role');

    const where: any = {};
    if (role && (role === 'ADMIN' || role === 'USER')) {
      where.role = role;
    }
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { mobileNumber: { contains: search, mode: 'insensitive' } },
      ];
    }

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        mobileNumber: true,
        image: true,
        authProvider: true,
        role: true,
        isBlacklisted: true,
        createdAt: true,
        _count: {
          select: { bookings: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(users);
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

    const { email, name, role } = await req.json();

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    // Only super admin can set role to ADMIN
    const targetRole = role === 'ADMIN' && session.email !== 'waheeddar8@gmail.com' ? 'USER' : (role || 'USER');

    const existingUser = await prisma.user.findUnique({ where: { email } });

    if (existingUser) {
      // If updating role to ADMIN, only super admin can do that
      if (targetRole === 'ADMIN' && session.email !== 'waheeddar8@gmail.com') {
        return NextResponse.json({ error: 'Only super admin can promote users to admin' }, { status: 403 });
      }
      const updated = await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          role: targetRole,
          ...(name && { name }),
        },
      });
      return NextResponse.json({ message: 'User updated successfully', user: updated });
    } else {
      const newUser = await prisma.user.create({
        data: {
          email,
          name: name || null,
          role: targetRole,
          authProvider: 'GOOGLE',
        },
      });
      return NextResponse.json({ message: 'User added successfully', user: newUser });
    }
  } catch (error) {
    console.error('Admin user add error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (session?.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { id, role } = await req.json();

    if (!id) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Prevent changing super admin's role
    if (user.email === 'waheeddar8@gmail.com') {
      return NextResponse.json({ error: 'Cannot modify super admin' }, { status: 400 });
    }

    // Only super admin can promote/demote admins
    if (role && (role === 'ADMIN' || user.role === 'ADMIN') && session.email !== 'waheeddar8@gmail.com') {
      return NextResponse.json({ error: 'Only super admin can change admin roles' }, { status: 403 });
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { ...(role && { role }) },
    });

    return NextResponse.json({ message: 'User updated', user: updated });
  } catch (error) {
    console.error('Admin user update error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (session?.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    if (session.email !== 'waheeddar8@gmail.com') {
      return NextResponse.json({ error: 'Only super admin can delete users' }, { status: 403 });
    }

    const { id } = await req.json();

    if (!id) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (user.email === 'waheeddar8@gmail.com') {
      return NextResponse.json({ error: 'Cannot delete super admin' }, { status: 400 });
    }

    // Delete user's bookings first (cascade), then user
    await prisma.booking.deleteMany({ where: { userId: id } });
    await prisma.otp.deleteMany({ where: { userId: id } });
    await prisma.user.delete({ where: { id } });

    return NextResponse.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Admin user delete error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
