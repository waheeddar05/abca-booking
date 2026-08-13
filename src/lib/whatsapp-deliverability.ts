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
 * WhatsApp" and warn honestly when no other channel (SMS) succeeded.
 *
 * The flag never blocks sending; it only informs error reporting. It is
 * cleared when the number proves reachable again (incoming message or a
 * delivered/read status) and expires automatically after 7 days.
 *
 * IMPORTANT — only "not reachable on WhatsApp" counts.
 * Meta reports a `failed` status for many reasons that say nothing about
 * whether the recipient is on WhatsApp: per-user pacing (131049), the
 * 24h re-engagement window (131047 / 470), template problems (132xxx),
 * user opt-out (131050), experiments (130472), account/rate limits.
 * Flagging on those locks reachable users out of the OTP flow, so both
 * the writer and the reader here gate on an explicit allowlist.
 */

import { prisma } from '@/lib/prisma';

const KEY_PREFIX = 'WA_UNDELIVERABLE_';
/** How long an undeliverable flag stays valid before we forget it. */
const FLAG_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Meta error codes that actually mean "this number cannot receive
 * WhatsApp messages" — i.e. the recipient is not a WhatsApp user or the
 * handset can't be reached at all.
 *
 * 131026 — "Message undeliverable": recipient is not a WhatsApp user,
 *          hasn't accepted the new ToS, or the number is unregistered.
 *
 * Everything else Meta can report as `failed` is transient, policy-based
 * or sender-side, and must NOT be treated as unreachable.
 */
const UNREACHABLE_ERROR_CODES: ReadonlySet<number> = new Set([131026]);

/** Whether a Meta error code proves the recipient isn't on WhatsApp. */
export function isUnreachableErrorCode(code: unknown): code is number {
  return typeof code === 'number' && UNREACHABLE_ERROR_CODES.has(code);
}

/**
 * Meta codes meaning "free-form message outside the 24h customer-service
 * window". 131047 on the Cloud API, 470 on older/on-premise payloads.
 */
const RE_ENGAGEMENT_ERROR_CODES: ReadonlySet<number> = new Set([131047, 470]);

/**
 * Account-level failures: Meta is refusing to deliver *anything* on this
 * WhatsApp Business account, for every recipient. Nothing about the
 * recipient's number is wrong, and no retry against a different number
 * will help — only fixing the account will.
 *
 * 131042 — Business eligibility payment issue (unsettled WABA billing)
 * 131031 — Account has been locked
 *    368 — Temporarily blocked for policy violations
 */
const ACCOUNT_BLOCKED_ERROR_CODES: ReadonlySet<number> = new Set([131042, 131031, 368]);

/** Whether a Meta error code means the whole WABA is refusing to send. */
export function isAccountBlockedErrorCode(code: unknown): code is number {
  return typeof code === 'number' && ACCOUNT_BLOCKED_ERROR_CODES.has(code);
}

const ACCOUNT_BLOCKED_KEY = 'WA_ACCOUNT_BLOCKED';
/**
 * Short TTL: an account block is an operational state someone is actively
 * fixing, not a durable fact about a number. It also self-heals — any
 * delivered/read status clears it — so this is only a backstop for the
 * case where no message gets delivered after the account recovers.
 */
const ACCOUNT_BLOCKED_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Record that Meta is refusing to deliver on this WABA. */
export async function markWhatsAppAccountBlocked(errorCode: number): Promise<void> {
  if (!isAccountBlockedErrorCode(errorCode)) return;

  const value = JSON.stringify({ at: new Date().toISOString(), code: errorCode });
  try {
    await prisma.policy.upsert({
      where: { key: ACCOUNT_BLOCKED_KEY },
      update: { value },
      create: { key: ACCOUNT_BLOCKED_KEY, value },
    });
    console.error(
      `[WhatsApp] ACCOUNT BLOCKED by Meta (code ${errorCode}) — no message will be delivered to anyone until this is resolved`,
    );
  } catch (err) {
    console.warn('[WhatsApp] Failed to record account-blocked flag:', err);
  }
}

/** Clear the account-blocked flag — a message just reached a device. */
export async function clearWhatsAppAccountBlocked(): Promise<void> {
  try {
    const res = await prisma.policy.deleteMany({ where: { key: ACCOUNT_BLOCKED_KEY } });
    if (res.count > 0) {
      console.log('[WhatsApp] Account-blocked flag cleared — delivery is working again');
    }
  } catch (err) {
    console.warn('[WhatsApp] Failed to clear account-blocked flag:', err);
  }
}

/**
 * Whether Meta recently refused to deliver on this WABA. Advisory only —
 * callers warn, they must not block on it.
 */
export async function isWhatsAppAccountBlocked(): Promise<boolean> {
  try {
    const row = await prisma.policy.findUnique({ where: { key: ACCOUNT_BLOCKED_KEY } });
    if (!row?.value) return false;

    const parsed = JSON.parse(row.value) as { at?: string; code?: unknown };
    if (!isAccountBlockedErrorCode(parsed?.code)) return false;

    const ts = parsed.at ? Date.parse(parsed.at) : NaN;
    if (Number.isNaN(ts)) return false;
    return Date.now() - ts < ACCOUNT_BLOCKED_TTL_MS;
  } catch {
    // Unparseable row or DB error — never let this gate misfire.
    return false;
  }
}

/**
 * Pull every Meta error code out of a `failed` status' `errors` array.
 * Codes live at `errors[i].code`; some payloads also carry a numeric code
 * under `errors[i].error_data.code`. Reading all of them avoids missing
 * the real reason just because it wasn't the first entry.
 */
export function extractErrorCodes(errors: unknown): number[] {
  if (!Array.isArray(errors)) return [];
  const codes: number[] = [];
  for (const err of errors) {
    const e = err as { code?: unknown; error_data?: { code?: unknown } } | null;
    if (typeof e?.code === 'number') codes.push(e.code);
    if (typeof e?.error_data?.code === 'number') codes.push(e.error_data.code);
  }
  return codes;
}

/**
 * Decide what a `failed` delivery status means.
 *
 * `unreachableCode` is set only for codes that prove the recipient isn't
 * on WhatsApp — that alone may raise the undeliverable flag. Everything
 * else (pacing, opt-out, templates, rate limits, the 24h window) is
 * logged but must not affect reachability, or reachable users get locked
 * out of the OTP flow for the life of the flag.
 */
export function classifyFailedStatus(errors: unknown): {
  codes: number[];
  isReEngagement: boolean;
  unreachableCode?: number;
  accountBlockedCode?: number;
} {
  const codes = extractErrorCodes(errors);
  return {
    codes,
    isReEngagement: codes.some((c) => RE_ENGAGEMENT_ERROR_CODES.has(c)),
    unreachableCode: codes.find(isUnreachableErrorCode),
    accountBlockedCode: codes.find(isAccountBlockedErrorCode),
  };
}

/** Normalize an Indian mobile (10-digit, 91XXXXXXXXXX, +91…) to 10 digits. */
export function normalizeTo10Digits(mobile: string): string {
  const digits = (mobile || '').replace(/\D/g, '');
  return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
}

function keyFor(mobile: string): string {
  return `${KEY_PREFIX}${normalizeTo10Digits(mobile)}`;
}

/**
 * Record that WhatsApp delivery to this number failed *because the number
 * isn't reachable on WhatsApp* (webhook `failed` status). Stores the Meta
 * error code for debugging.
 *
 * No-op unless `errorCode` is in {@link UNREACHABLE_ERROR_CODES}. A
 * missing or unrelated code (pacing, template, opt-out, window) is not
 * evidence about reachability and must never raise the flag.
 */
export async function markWhatsAppUndeliverable(
  mobile: string,
  errorCode?: number,
): Promise<void> {
  const mobile10 = normalizeTo10Digits(mobile);
  if (!/^\d{10}$/.test(mobile10)) return;

  if (!isUnreachableErrorCode(errorCode)) {
    console.warn(
      `[WhatsApp] Not flagging ${mobile10}: error ${errorCode ?? 'unknown'} does not mean "not on WhatsApp"`,
    );
    return;
  }

  const value = JSON.stringify({ at: new Date().toISOString(), code: errorCode });
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
 * Whether this number recently proved unreachable on WhatsApp.
 *
 * Returns false for stale flags (older than 7 days), for flags written
 * with a code that doesn't mean "not on WhatsApp" (older builds wrote
 * those; they stay in the Policy table until they expire), for flags
 * with no attributable code, and on any read error.
 */
export async function isWhatsAppUndeliverable(mobile: string): Promise<boolean> {
  const mobile10 = normalizeTo10Digits(mobile);
  if (!/^\d{10}$/.test(mobile10)) return false;

  try {
    const row = await prisma.policy.findUnique({ where: { key: keyFor(mobile10) } });
    if (!row?.value) return false;

    let at: string | undefined;
    let code: unknown;
    try {
      const parsed = JSON.parse(row.value) as { at?: string; code?: unknown };
      at = parsed?.at;
      code = parsed?.code;
    } catch {
      // Legacy plain-ISO value: no code, so the failure can't be
      // attributed to unreachability. Don't act on it.
      return false;
    }

    // Written by an older build from an unrelated failure code.
    if (!isUnreachableErrorCode(code)) return false;

    const ts = at ? Date.parse(at) : NaN;
    if (Number.isNaN(ts)) return false;
    return Date.now() - ts < FLAG_TTL_MS;
  } catch (err) {
    console.warn('[WhatsApp] Failed to read undeliverable flag:', err);
    return false;
  }
}
