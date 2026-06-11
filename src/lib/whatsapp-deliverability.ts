/**
 * WhatsApp deliverability tracking.
 *
 * Meta accepts a message at send time (API returns success) but may fail
 * delivery asynchronously — the failure only arrives later on the webhook
 * as a `failed` status (e.g. code 131026 "Message undeliverable", typically
 * a number that isn't on WhatsApp). From the sender's point of view the
 * send "worked", so OTP flows wrongly report success to the user.
 *
 * This module records undeliverable recipients (reported by the webhook)
 * in the Policy KV table — same pattern as the WA_CONV_* conversation
 * window keys — so send paths can detect "this number can't receive
 * WhatsApp" and fail honestly when no other channel (SMS) succeeded.
 *
 * The flag never blocks sending; it only informs error reporting. It is
 * cleared when the number proves reachable again (incoming message or a
 * delivered/read status) and expires automatically after 7 days.
 */

import { prisma } from '@/lib/prisma';

const KEY_PREFIX = 'WA_UNDELIVERABLE_';
/** How long an undeliverable flag stays valid before we forget it. */
const FLAG_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Normalize an Indian mobile (10-digit, 91XXXXXXXXXX, +91…) to 10 digits. */
export function normalizeTo10Digits(mobile: string): string {
  const digits = (mobile || '').replace(/\D/g, '');
  return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
}

function keyFor(mobile: string): string {
  return `${KEY_PREFIX}${normalizeTo10Digits(mobile)}`;
}

/**
 * Record that WhatsApp delivery to this number failed (webhook `failed`
 * status). Stores the Meta error code for debugging.
 */
export async function markWhatsAppUndeliverable(
  mobile: string,
  errorCode?: number,
): Promise<void> {
  const mobile10 = normalizeTo10Digits(mobile);
  if (!/^\d{10}$/.test(mobile10)) return;

  const value = JSON.stringify({ at: new Date().toISOString(), code: errorCode ?? null });
  try {
    await prisma.policy.upsert({
      where: { key: keyFor(mobile10) },
      update: { value },
      create: { key: keyFor(mobile10), value },
    });
    console.warn(`[WhatsApp] Marked ${mobile10} as undeliverable (code ${errorCode ?? 'unknown'})`);
  } catch (err) {
    // Non-critical — log and continue
    console.warn('[WhatsApp] Failed to record undeliverable flag:', err);
  }
}

/**
 * Clear the undeliverable flag — the number proved reachable (incoming
 * message, or a delivered/read status callback).
 */
export async function clearWhatsAppUndeliverable(mobile: string): Promise<void> {
  const mobile10 = normalizeTo10Digits(mobile);
  if (!/^\d{10}$/.test(mobile10)) return;

  try {
    const res = await prisma.policy.deleteMany({ where: { key: keyFor(mobile10) } });
    if (res.count > 0) {
      console.log(`[WhatsApp] Cleared undeliverable flag for ${mobile10}`);
    }
  } catch (err) {
    console.warn('[WhatsApp] Failed to clear undeliverable flag:', err);
  }
}

/**
 * Whether WhatsApp delivery to this number recently failed.
 * Returns false for stale flags (older than 7 days) and on any read error.
 */
export async function isWhatsAppUndeliverable(mobile: string): Promise<boolean> {
  const mobile10 = normalizeTo10Digits(mobile);
  if (!/^\d{10}$/.test(mobile10)) return false;

  try {
    const row = await prisma.policy.findUnique({ where: { key: keyFor(mobile10) } });
    if (!row?.value) return false;

    let at: string | undefined;
    try {
      const parsed = JSON.parse(row.value) as { at?: string };
      at = parsed?.at;
    } catch {
      at = row.value; // tolerate a plain ISO timestamp
    }

    const ts = at ? Date.parse(at) : NaN;
    if (Number.isNaN(ts)) return false;
    return Date.now() - ts < FLAG_TTL_MS;
  } catch (err) {
    console.warn('[WhatsApp] Failed to read undeliverable flag:', err);
    return false;
  }
}
