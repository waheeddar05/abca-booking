import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { getAuthenticatedUser } from '@/lib/auth';
import { sendWhatsAppOTP, sendWhatsAppNotification, isValidIndianMobile } from '@/lib/whatsapp';
import { sendSMS } from '@/lib/sms';
import { getCachedPolicy } from '@/lib/policy-cache';
import { isWhatsAppUndeliverable } from '@/lib/whatsapp-deliverability';

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
    const otpRecord = await prisma.otp.create({
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

    // Strategy 2: If no auth template, send OTP via utility template
    // Uses playorbit_account_pin template: "Reference: {{1}}, Status: {{2}}"
    if (!whatsappSent && waEnabled === 'true') {
      try {
        const ttl = process.env.OTP_TTL_MINUTES || '5';

        const waResult = await sendWhatsAppNotification(
          cleaned,
          'playorbit_account_pin',
          [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: otp },
                { type: 'text', text: `Enter this on the app within ${ttl} min. Do not share.` },
              ],
            },
          ],
          'en',
        );

        whatsappSent = waResult?.success || false;
        if (whatsappSent) {
          console.log('[send-otp] WhatsApp OTP sent via utility template:', { userId: user.id });
        } else {
          console.warn('[send-otp] WhatsApp utility template OTP failed:', waResult?.error);
        }
      } catch (err) {
        console.warn('[send-otp] WhatsApp utility OTP error:', err instanceof Error ? err.message : err);
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
      // Nothing was sent, so this attempt must not eat into the
      // 3-per-10-minutes budget — otherwise a provider outage locks the
      // user out for 10 minutes after three no-op tries.
      await prisma.otp.delete({ where: { id: otpRecord.id } }).catch(() => {});
      return NextResponse.json(
        { error: 'Failed to send OTP. Please try again later.' },
        { status: 502 },
      );
    }

    // Meta "accepts" sends to numbers that aren't on WhatsApp and only
    // reports the failure later via webhook (error 131026). If this number
    // was flagged unreachable and SMS didn't go out either, the code may
    // not arrive — say so, but do NOT block: the flag describes an earlier
    // message (up to 7 days old), while this send was accepted just now.
    // Blocking here strands the user on the phone-number screen with no
    // way to enter a code that may well have been delivered, and
    // /verify-mobile is the only route into the app after Google sign-in.
    let warning: string | undefined;
    if (!smsSent && whatsappSent && (await isWhatsAppUndeliverable(cleaned))) {
      console.warn(
        '[send-otp] WhatsApp accepted but number was recently flagged unreachable, and SMS failed:',
        { userId: user.id },
      );
      warning =
        "We couldn't reach this number on WhatsApp recently, and SMS is temporarily unavailable. If the code doesn't arrive, try a WhatsApp-enabled number.";
    }

    const channel = whatsappSent && smsSent ? 'WhatsApp & SMS' : smsSent ? 'SMS' : 'WhatsApp';
    console.log('[send-otp] OTP delivered via:', channel, 'for user:', user.id);

    return NextResponse.json({
      message: `OTP sent to your ${smsSent ? 'phone' : 'WhatsApp'}`,
      channel,
      ...(warning ? { warning } : {}),
    });
  } catch (error) {
    console.error('WhatsApp send-otp error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
