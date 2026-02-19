import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth';
import { validatePackageBooking } from '@/lib/packages';
import { type BallType, type PitchType } from '@prisma/client';

// POST /api/packages/validate-booking - Check if a package can be used for a booking & get extra charges
export async function POST(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { userPackageId, ballType, pitchType, startTime, numberOfSlots = 1, userId: targetUserId } = body;

    if (!userPackageId || !ballType || !startTime) {
      return NextResponse.json({ error: 'userPackageId, ballType, and startTime are required' }, { status: 400 });
    }

    // Allow admins to validate packages for other users
    const validationUserId = (user.role === 'ADMIN' && targetUserId) ? targetUserId : user.id;

    const result = await validatePackageBooking(
      userPackageId,
      validationUserId,
      ballType as BallType,
      (pitchType as PitchType) || null,
      new Date(startTime),
      numberOfSlots
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error('Validate package booking error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
