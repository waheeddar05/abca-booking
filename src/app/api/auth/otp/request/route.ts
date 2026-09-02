import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isValidIndianMobile } from '@/lib/whatsapp';
import { issueAndSendOtp, normalizeIndianMobile } from '@/lib/otp-delivery';

/**
 * POST /api/auth/otp/request — step 1 of the WhatsApp login.
 *
 * Takes a mobile number, finds or creates the account that owns it, and
 * sends a one-time code (WhatsApp first, SMS as the backstop — see
 * `@/lib/otp-delivery`). Step 2 is `POST /api/auth/otp/verify`, which
 * checks the code and issues the session cookie.
 *
 * Public by design: this IS the way in, so it cannot require a session.
 * That makes it the app's most exposed write path, hence:
 *   - the number is validated before any row is touched;
 *   - `issueAndSendOtp` rate-limits to 3 codes per 10 minutes per account;
 *   - the response never reveals whether the number was already registered,
 *     so it can't be used to enumerate customers.
 *
 * Body: { mobileNumber: string }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { mobileNumber } = body as { mobileNumber?: string };

    if (!mobileNumber) {
      return NextResponse.json({ error: 'Mobile number is required' }, { status: 400 });
    }

    if (!isValidIndianMobile(mobileNumber)) {
      return NextResponse.json(
        { error: 'Please enter a valid Indian mobile number (10 digits starting with 6-9)' },
        { status: 400 },
      );
    }

    const cleaned = normalizeIndianMobile(mobileNumber);

    // Find-or-create by mobile number. The number IS the identity for this
    // flow — an account is only ever matched to a number the caller has
    // just proven they can receive a code on (in step 2).
    let user = await prisma.user.findUnique({
      where: { mobileNumber: cleaned },
      select: { id: true },
    });

    if (!user) {
      const isInitialAdmin =
        !!process.env.INITIAL_ADMIN_MOBILE &&
        normalizeIndianMobile(process.env.INITIAL_ADMIN_MOBILE) === cleaned;
      user = await prisma.user.create({
        data: {
          mobileNumber: cleaned,
          authProvider: 'WHATSAPP',
          role: isInitialAdmin ? 'ADMIN' : 'USER',
          // Not verified until the code in step 2 checks out. The row has
          // to exist first because the OTP is stored against a userId.
          mobileVerified: false,
        },
        select: { id: true },
      });
    }

    const result = await issueAndSendOtp({
      userId: user.id,
      mobileNumber: cleaned,
      logTag: '[otp.login]',
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      message: `Code sent to your ${result.channel === 'SMS' ? 'phone' : 'WhatsApp'}`,
      channel: result.channel,
      ...(result.warning ? { warning: result.warning } : {}),
    });
  } catch (error) {
    console.error('OTP request error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
