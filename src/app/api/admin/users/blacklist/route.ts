import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const admin = await getAuthenticatedUser(req);

    if (!admin || admin.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { userId, isBlacklisted } = await req.json();

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: { isBlacklisted },
    });

    return NextResponse.json({
      message: `User ${isBlacklisted ? 'blocked' : 'unblocked'} successfully`,
      user
    });

  } catch (error) {
    console.error('Blacklist user error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
