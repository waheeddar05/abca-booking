/**
 * OTP issue + delivery pipeline, shared by both flows that send a code:
 *
 *   - `POST /api/auth/otp/request`      — WhatsApp LOGIN (no session yet)
 *   - `POST /api/auth/whatsapp/send-otp` — linking a number to an account
 *
 * The delivery ladder itself is the valuable part and must not be
 * duplicated: two WhatsApp strategies (an approved authentication template
 * when the business is verified, else the `playorbit_account_pin` utility
 * template), SMS as the backstop, rate limiting, and the rule that a send
 * which reached nobody is rolled back so a provider outage can't burn the
 * user's request budget.
 *
 * WhatsApp is the primary channel — SMS only fires as a fallback so a
 * WhatsApp outage can't lock every user out of an app whose only login is
 * WhatsApp.
 */

import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { sendWhatsAppOTP, sendWhatsAppNotification } from '@/lib/whatsapp';
import { sendSMS } from '@/lib/sms';
import { getCachedPolicy } from '@/lib/policy-cache';
import {
  isWhatsAppUndeliverable,
  isWhatsAppAccountBlocked,
} from '@/lib/whatsapp-deliverability';

/** Max OTPs a single user may request inside RATE_WINDOW_MS. */
const RATE_LIMIT = 3;
const RATE_WINDOW_MS = 10 * 60 * 1000;

/**
 * Platform-wide circuit breaker on code issuance.
 *
 * The per-user limit above is keyed on the account, and `/api/auth/otp/request`
 * is public and creates an account for any valid-looking number — so an
 * attacker cycling numbers never trips it while every call spends real
 * money on a WhatsApp template or an SMS. This caps total issuance per
 * minute across all users, trading a brief 429 during an implausible spike
 * for a bounded bill. Raise it with OTP_GLOBAL_PER_MINUTE if a genuinely
 * busy center ever approaches the ceiling.
 */
const GLOBAL_WINDOW_MS = 60 * 1000;
function globalLimit(): number {
  return Number(process.env.OTP_GLOBAL_PER_MINUTE) || 30;
}

export interface OtpDeliveryResult {
  ok: boolean;
  /** HTTP status the caller should return. */
  status: number;
  /** Human-readable channel the code went out on ("WhatsApp", "SMS", …). */
  channel?: string;
  /** Non-blocking caveat about deliverability, surfaced to the user. */
  warning?: string;
  /** Set when ok === false. */
  error?: string;
}

/** Normalize an Indian mobile to the bare 10 digits used for storage. */
export function normalizeIndianMobile(mobileNumber: string): string {
  const digits = mobileNumber.replace(/\D/g, '');
  return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
}

/**
 * Generate a 6-digit code, store its hash against the user, and deliver it.
 *
 * Returns a result rather than throwing so both callers can shape their own
 * response. Never leaks the code itself.
 */
export async function issueAndSendOtp(opts: {
  userId: string;
  /** Already normalized to 10 digits. */
  mobileNumber: string;
  /** Log prefix, e.g. '[otp.login]'. */
  logTag: string;
}): Promise<OtpDeliveryResult> {
  const { userId, mobileNumber, logTag } = opts;

  // ── Rate limit: this account ──
  const windowStart = new Date(Date.now() - RATE_WINDOW_MS);
  const recentOtps = await prisma.otp.count({
    where: { userId, createdAt: { gte: windowStart } },
  });
  if (recentOtps >= RATE_LIMIT) {
    return {
      ok: false,
      status: 429,
      error: 'Too many code requests. Please wait a few minutes and try again.',
    };
  }

  // ── Rate limit: the whole platform (spend circuit breaker) ──
  const globalSince = new Date(Date.now() - GLOBAL_WINDOW_MS);
  const globalRecent = await prisma.otp.count({ where: { createdAt: { gte: globalSince } } });
  if (globalRecent >= globalLimit()) {
    console.error(`${logTag} Global OTP rate limit hit — refusing to issue:`, {
      inLastMinute: globalRecent,
      limit: globalLimit(),
    });
    return {
      ok: false,
      status: 429,
      error: 'We are handling a lot of sign-ins right now. Please try again in a minute.',
    };
  }

  // ── Issue ──
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const hashedOtp = await bcrypt.hash(otp, 10);
  const expiresAt = new Date(Date.now() + (Number(process.env.OTP_TTL_MINUTES) || 10) * 60000);

  const otpRecord = await prisma.otp.create({
    data: { userId, codeHash: hashedOtp, expiresAt },
  });

  // ── Deliver ──
  let whatsappSent = false;
  let smsSent = false;

  const waEnabled = await getCachedPolicy('WHATSAPP_NOTIFICATIONS_ENABLED');
  const waTemplate = process.env.WHATSAPP_OTP_TEMPLATE || '';

  // Strategy 1 — approved authentication template (business verified).
  if (waTemplate && waTemplate !== 'text') {
    try {
      const waResult = await sendWhatsAppOTP(mobileNumber, otp);
      whatsappSent = waResult.success;
      if (!waResult.success) {
        console.warn(`${logTag} WhatsApp auth template failed:`, waResult.error);
      }
    } catch (err) {
      console.warn(`${logTag} WhatsApp auth OTP error:`, err instanceof Error ? err.message : err);
    }
  }

  // Strategy 2 — utility template ("Reference: {{1}}, Status: {{2}}").
  if (!whatsappSent && waEnabled === 'true') {
    try {
      const ttl = process.env.OTP_TTL_MINUTES || '5';
      const waResult = await sendWhatsAppNotification(
        mobileNumber,
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
      if (!whatsappSent) {
        console.warn(`${logTag} WhatsApp utility template failed:`, waResult?.error);
      }
    } catch (err) {
      console.warn(`${logTag} WhatsApp utility OTP error:`, err instanceof Error ? err.message : err);
    }
  }

  // SMS backstop — always attempted. WhatsApp is the login channel, but a
  // BSP outage must not lock every user out of the only way in.
  try {
    const smsResult = await sendSMS(mobileNumber, otp);
    smsSent = smsResult.success;
    if (!smsResult.success) {
      console.warn(`${logTag} SMS OTP failed:`, smsResult.error);
    }
  } catch (err) {
    console.warn(`${logTag} SMS OTP error:`, err instanceof Error ? err.message : err);
  }

  if (!whatsappSent && !smsSent) {
    console.error(`${logTag} Both WhatsApp and SMS failed for user:`, userId);
    // Nothing was sent, so this attempt must not eat into the rate-limit
    // budget — otherwise a provider outage locks the user out for the whole
    // window after three no-op tries.
    await prisma.otp.delete({ where: { id: otpRecord.id } }).catch(() => {});
    return {
      ok: false,
      status: 502,
      error: "We couldn't send your code right now. Please try again in a moment.",
    };
  }

  // Meta "accepts" sends to numbers that aren't on WhatsApp and only reports
  // the failure later by webhook (error 131026). When the code may not
  // arrive we say so — but never block: the flag describes an earlier
  // message (up to 7 days old) while this send was accepted just now, and
  // blocking would strand the user on the phone-number screen with no way
  // to enter a code that may well have been delivered.
  let warning: string | undefined;
  if (!smsSent && whatsappSent && (await isWhatsAppAccountBlocked())) {
    // An account-level refusal (unpaid WABA billing, locked account, policy
    // block) outranks anything about this particular number — Meta is
    // delivering nothing to anyone, so don't send the user chasing a fault
    // on their side that doesn't exist.
    console.error(`${logTag} WhatsApp accepted but the business account is blocked, and SMS is unavailable:`, { userId });
    warning =
      "WhatsApp messaging is temporarily unavailable on our side, so your code may be delayed. This isn't a problem with your number — we're working on it.";
  } else if (!smsSent && whatsappSent && (await isWhatsAppUndeliverable(mobileNumber))) {
    console.warn(`${logTag} WhatsApp accepted but number was recently flagged unreachable, and SMS failed:`, { userId });
    warning =
      "We couldn't reach this number on WhatsApp recently, and SMS is temporarily unavailable. If the code doesn't arrive, try a WhatsApp-enabled number.";
  }

  const channel = whatsappSent && smsSent ? 'WhatsApp & SMS' : smsSent ? 'SMS' : 'WhatsApp';
  console.log(`${logTag} OTP delivered via:`, channel, 'for user:', userId);

  return { ok: true, status: 200, channel, ...(warning ? { warning } : {}) };
}
