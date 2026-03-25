import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // getAuthenticatedUser already fetched user from DB; select only the extra
    // fields not present on the auth object to avoid a redundant full query.
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        mobileNumber: true,
        mobileVerified: true,
        phonePromptDismissed: true,
        authProvider: true,
        image: true,
      },
    });

    return NextResponse.json(dbUser, {
      headers: {
        'Cache-Control': 'private, s-maxage=30, stale-while-revalidate=60',
      },
    });
  } catch (error) {
    console.error('Get user profile error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const data: any = {};

    if (body.mobileNumber) {
      // Validate Indian mobile number
      const cleaned = body.mobileNumber.replace(/\D/g, '');
      if (!/^[6-9]\d{9}$/.test(cleaned)) {
        return NextResponse.json({ error: 'Invalid mobile number' }, { status: 400 });
      }

      // Check if number is already in use by another user
      const existing = await prisma.user.findUnique({
        where: { mobileNumber: cleaned },
      });
      if (existing && existing.id !== user.id) {
        return NextResponse.json({ error: 'This mobile number is already registered' }, { status: 409 });
      }

      data.mobileNumber = cleaned;
    }

    if (body.phonePromptDismissed !== undefined) {
      data.phonePromptDismissed = Boolean(body.phonePromptDismissed);
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data,
      select: {
        id: true,
        name: true,
        email: true,
        mobileNumber: true,
        phonePromptDismissed: true,
      },
    });

    return NextResponse.json(updated);
  } catch (error: any) {
    console.error('Update user profile error:', error);
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}
