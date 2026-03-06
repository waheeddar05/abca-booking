import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { getAuthenticatedUser } from '@/lib/auth';
import { sendWhatsAppOTP, isValidIndianMobile } from '@/lib/whatsapp';
import { getCachedPolicy } from '@/lib/policy-cache';

/**
 * POST /api/auth/whatsapp/send-otp
 *
 * Requires an authenticated Google session. Sends a WhatsApp OTP
 * to the provided mobile number so the user can verify ownership
 * and link the number to their account.
 *
 * Body: { mobileNumber: string }
 */
export async function POST(req: NextRequest) {
  try {
    // Feature flag check
    const enabled = await getCachedPolicy('WHATSAPP_LOGIN_ENABLED');
    if (enabled === 'false') {
      return NextResponse.json(
        { error: 'WhatsApp verification is currently disabled' },
        { status: 403 },
      );
    }

    // Must be logged in via Google first
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized — please sign in with Google first' }, { status: 401 });
    }

    const { mobileNumber } = await req.json();

    if (!mobileNumber) {
      return NextResponse.json({ error: 'Mobile number is required' }, { status: 400 });
    }

    if (!isValidIndianMobile(mobileNumber)) {
      return NextResponse.json(
        { error: 'Please enter a valid Indian mobile number (10 digits starting with 6-9)' },
        { status: 400 },
      );
    }

    // Normalize to 10 digits for storage
    const digits = mobileNumber.replace(/\D/g, '');
    const cleaned = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;

    // Check if this mobile is already linked to ANOTHER user
    const existingUser = await prisma.user.findUnique({
      where: { mobileNumber: cleaned },
    });

    if (existingUser && existingUser.id !== user.id) {
      return NextResponse.json(
        { error: 'This mobile number is already linked to another account' },
        { status: 409 },
      );
    }

    // Rate limiting: max 3 OTPs in 10 minutes for this user
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const recentOtps = await prisma.otp.count({
      where: {
        userId: user.id,
        createdAt: { gte: tenMinutesAgo },
      },
    });

    if (recentOtps >= 3) {
      return NextResponse.json(
        { error: 'Too many OTP requests. Please wait a few minutes.' },
        { status: 429 },
      );
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedOtp = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + (Number(process.env.OTP_TTL_MINUTES) || 10) * 60000);

    // Store OTP
    await prisma.otp.create({
      data: {
        userId: user.id,
        codeHash: hashedOtp,
        expiresAt,
      },
    });

    // Send OTP via WhatsApp
    const result = await sendWhatsAppOTP(cleaned, otp);

    if (!result.success) {
      console.error('[send-otp] WhatsApp OTP send failed:', {
        userId: user.id,
        mobile: cleaned.slice(0, 4) + '****' + cleaned.slice(-2),
        error: result.error,
      });
      return NextResponse.json(
        { error: result.error || 'Failed to send WhatsApp OTP. Please try again.' },
        { status: 502 },
      );
    }

    console.log('[send-otp] WhatsApp OTP sent successfully:', {
      userId: user.id,
      messageId: result.messageId,
    });

    return NextResponse.json({
      message: 'OTP sent to your WhatsApp',
      messageId: result.messageId,
    });
  } catch (error) {
    console.error('WhatsApp send-otp error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
