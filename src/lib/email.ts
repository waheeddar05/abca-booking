/**
 * The account's email — one validator, shared by the profile form and the
 * API, the same way `display-name.ts` handles the name.
 *
 * Login is WhatsApp OTP, so email is optional contact information rather
 * than an identity: a user adds one for receipts and store enquiries, and
 * may clear it again. Legacy Google accounts are keyed on it, which is why
 * the API only lets an account clear its email when it still has a mobile
 * number to be reached by.
 */

export const MAX_EMAIL_LENGTH = 120;

/** Pragmatic shape check — one @, something either side, a dot in the domain, no whitespace. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type EmailValidation =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

/**
 * Trim and lower-case; an empty string means "no email" (null). Rejects
 * anything that doesn't look like an address or is unreasonably long.
 */
export function normalizeEmail(input: unknown): EmailValidation {
  const raw = String(input ?? '').trim();
  if (raw.length === 0) return { ok: true, value: null };
  if (raw.length > MAX_EMAIL_LENGTH) {
    return { ok: false, error: `Please keep the email under ${MAX_EMAIL_LENGTH} characters.` };
  }
  const value = raw.toLowerCase();
  if (!EMAIL_PATTERN.test(value)) {
    return { ok: false, error: 'Please enter a valid email address.' };
  }
  return { ok: true, value };
}
