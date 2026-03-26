import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { getAuthenticatedUser } from '@/lib/auth';
import { sendWhatsAppOTP, sendWhatsAppNotification, sendWhatsAppText, isValidIndianMobile } from '@/lib/whatsapp';
import { sendSMS } from '@/lib/sms';
import { getCachedPolicy } from '@/lib/policy-cache';

/**
 * POST /api/auth/whatsapp/send-otp
 *
 * Requires an authenticated Google session. Sends an OTP
 * to the provided mobile number so the user can verify ownership
 * and link the number to their account.
 *
 * Delivery strategy:
 *   1. Try WhatsApp first (if configured)
 *   2. Always send SMS as fallback/backup via Fast2SMS
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

    // Send OTP via WhatsApp (template + text) and SMS
    let whatsappSent = false;
    let smsSent = false;
    let smsProvider = '';

    const waEnabled = await getCachedPolicy('WHATSAPP_NOTIFICATIONS_ENABLED');
    const waTemplate = process.env.WHATSAPP_OTP_TEMPLATE || '';

    // Strategy 1: If auth template exists (business verified), use it directly
    if (waTemplate && waTemplate !== 'text') {
      try {
        const waResult = await sendWhatsAppOTP(cleaned, otp);
        whatsappSent = waResult.success;
        if (waResult.success) {
          console.log('[send-otp] WhatsApp OTP sent via auth template:', { userId: user.id });
        } else {
          console.warn('[send-otp] WhatsApp auth template failed:', waResult.error);
        }
      } catch (err) {
        console.warn('[send-otp] WhatsApp auth OTP error:', err instanceof Error ? err.message : err);
      }
    }

    // Strategy 2: If no auth template, send welcome template (opens conversation)
    // then send OTP as plain text
    if (!whatsappSent && waEnabled === 'true') {
      try {
        const ttl = process.env.OTP_TTL_MINUTES || '5';

        // Send welcome template to open conversation window
        await sendWhatsAppNotification(cleaned, 'playorbit_welcome', [], 'en');

        // Small delay to ensure template is processed first
        await new Promise(resolve => setTimeout(resolve, 500));

        // Send OTP as plain text (works within conversation window)
        const textResult = await sendWhatsAppText(
          cleaned,
          `🔐 Your PlayOrbit verification code is: *${otp}*\n\nIt expires in ${ttl} minutes. Do not share this code with anyone.`,
        );

        whatsappSent = textResult?.success || false;
        if (whatsappSent) {
          console.log('[send-otp] WhatsApp OTP sent via template+text:', { userId: user.id });
        } else {
          console.warn('[send-otp] WhatsApp text OTP failed:', textResult?.error);
        }
      } catch (err) {
        console.warn('[send-otp] WhatsApp template+text OTP error:', err instanceof Error ? err.message : err);
      }
    }

    // SMS fallback (always try)
    try {
      const smsResult = await sendSMS(cleaned, otp);
      smsSent = smsResult.success;
      smsProvider = smsResult.provider || '';
      if (smsResult.success) {
        console.log('[send-otp] SMS OTP sent via', smsProvider, 'to:', cleaned.slice(0, 4) + '****' + cleaned.slice(-2));
      } else {
        console.warn('[send-otp] SMS OTP failed:', smsResult.error, '(provider:', smsProvider, ')');
      }
    } catch (err) {
      console.warn('[send-otp] SMS OTP error:', err instanceof Error ? err.message : err);
    }

    if (!whatsappSent && !smsSent) {
      console.error('[send-otp] Both WhatsApp and SMS failed for user:', user.id);
      return NextResponse.json(
        { error: 'Failed to send OTP. Please try again later.' },
        { status: 502 },
      );
    }

    const channel = whatsappSent && smsSent ? 'WhatsApp & SMS' : smsSent ? 'SMS' : 'WhatsApp';
    console.log('[send-otp] OTP delivered via:', channel, 'for user:', user.id);

    return NextResponse.json({
      message: `OTP sent to your ${smsSent ? 'phone' : 'WhatsApp'}`,
      channel,
    });
  } catch (error) {
    console.error('WhatsApp send-otp error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
