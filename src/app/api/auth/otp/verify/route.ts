import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { signToken } from '@/lib/jwt';
import { normalizeIndianMobile } from '@/lib/otp-delivery';

/**
 * POST /api/auth/otp/verify — step 2 of the WhatsApp login.
 *
 * Checks the code issued by `/api/auth/otp/request` and, on success, sets
 * the `token` cookie that `getAuthenticatedUser` reads. This is the only
 * way a session is created in the app.
 */
export async function POST(req: NextRequest) {
  try {
    const { mobileNumber, otp } = await req.json();

    if (!mobileNumber || !otp) {
      return NextResponse.json({ error: 'Mobile number and OTP are required' }, { status: 400 });
    }

    // Normalize the same way the request step stored it, so a number typed
    // as +91XXXXXXXXXX still resolves to the row keyed on 10 digits.
    const cleaned = normalizeIndianMobile(mobileNumber);

    const user = await prisma.user.findUnique({
      where: { mobileNumber: cleaned },
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

    if (!user || user.otps.length === 0) {
      return NextResponse.json({ error: 'Invalid or expired OTP' }, { status: 400 });
    }

    const latestOtp = user.otps[0];

    // Brute-force guard. The code is 6 digits and lives for OTP_TTL_MINUTES,
    // so without a cap the whole keyspace is guessable inside the window —
    // and this is the only login. Each wrong guess is counted; past the cap
    // the code is burned and the user has to request a new one (which the
    // 3-per-10-minutes issue limit then bounds too).
    const maxAttempts = Number(process.env.OTP_MAX_ATTEMPTS) || 5;
    if (latestOtp.attempts >= maxAttempts) {
      await prisma.otp.update({ where: { id: latestOtp.id }, data: { used: true } });
      return NextResponse.json(
        { error: 'Too many incorrect attempts. Please request a new code.' },
        { status: 429 },
      );
    }

    const isMatch = await bcrypt.compare(otp, latestOtp.codeHash);

    if (!isMatch) {
      const attempts = latestOtp.attempts + 1;
      await prisma.otp.update({
        where: { id: latestOtp.id },
        // Burn the code on the last allowed miss rather than leaving it
        // live for the rest of its TTL.
        data: { attempts, used: attempts >= maxAttempts },
      });
      return NextResponse.json({ error: 'Invalid OTP' }, { status: 400 });
    }

    // Mark the code used and stamp the login. Receiving the code IS proof
    // of the number, so the account is mobile-verified from here on — that
    // is what keeps a WhatsApp user out of the /verify-mobile gate, which
    // exists only to collect a number Google sign-in never provided.
    // Atomic: a used code must never leave the account unverified.
    await prisma.$transaction([
      prisma.otp.update({
        where: { id: latestOtp.id },
        data: { used: true },
      }),
      prisma.user.update({
        where: { id: user.id },
        data: {
          lastSeen: new Date(),
          mobileVerified: true,
          phonePromptDismissed: true,
        },
      }),
    ]);

    // The middleware reads `role` off this token to gate /admin and /staff,
    // so it has to carry the same shape the NextAuth token does.
    // `mobileVerified` is always true here by construction (above).
    const token = await signToken({
      userId: user.id,
      name: user.name,
      email: user.email,
      mobileNumber: user.mobileNumber,
      role: user.role,
      mobileVerified: true,
    });

    const response = NextResponse.json({ message: 'Login successful' });
    response.cookies.set('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60, // 7 days
      path: '/',
    });

    return response;
  } catch (error) {
    console.error('OTP verify error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
