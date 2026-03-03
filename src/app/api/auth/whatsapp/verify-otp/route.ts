import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { getAuthenticatedUser } from '@/lib/auth';
import { isValidIndianMobile } from '@/lib/whatsapp';

/**
 * POST /api/auth/whatsapp/verify-otp
 *
 * Verifies the WhatsApp OTP and links the mobile number to the
 * authenticated user's account. Sets mobileVerified = true.
 *
 * Body: { mobileNumber: string, otp: string }
 */
export async function POST(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { mobileNumber, otp } = await req.json();

    if (!mobileNumber || !otp) {
      return NextResponse.json(
        { error: 'Mobile number and OTP are required' },
        { status: 400 },
      );
    }

    if (!isValidIndianMobile(mobileNumber)) {
      return NextResponse.json(
        { error: 'Invalid mobile number' },
        { status: 400 },
      );
    }

    // Normalize to 10 digits
    const digits = mobileNumber.replace(/\D/g, '');
    const cleaned = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;

    // Double-check mobile isn't taken by another user
    const existingUser = await prisma.user.findUnique({
      where: { mobileNumber: cleaned },
    });

    if (existingUser && existingUser.id !== user.id) {
      return NextResponse.json(
        { error: 'This mobile number is already linked to another account' },
        { status: 409 },
      );
    }

    // Find the latest unused, non-expired OTP for this user
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      include: {
        otps: {
          where: {
            used: false,
            expiresAt: { gt: new Date() },
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!dbUser || dbUser.otps.length === 0) {
      return NextResponse.json({ error: 'Invalid or expired OTP' }, { status: 400 });
    }

    const latestOtp = dbUser.otps[0];
    const isMatch = await bcrypt.compare(otp, latestOtp.codeHash);

    if (!isMatch) {
      return NextResponse.json({ error: 'Invalid OTP' }, { status: 400 });
    }

    // Mark OTP as used + link mobile number + set verified
    await prisma.$transaction([
      prisma.otp.update({
        where: { id: latestOtp.id },
        data: { used: true },
      }),
      prisma.user.update({
        where: { id: user.id },
        data: {
          mobileNumber: cleaned,
          mobileVerified: true,
          phonePromptDismissed: true,
        },
      }),
    ]);

    return NextResponse.json({
      message: 'Mobile number verified successfully',
      mobileNumber: cleaned,
      verified: true,
    });
  } catch (error) {
    console.error('WhatsApp verify-otp error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
