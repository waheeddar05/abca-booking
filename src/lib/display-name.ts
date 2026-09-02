/**
 * The user's display name — one validator, shared by the form and the API.
 *
 * WhatsApp login gives us a phone number and nothing else. Google used to
 * hand over a name; now the account is created with `name: null`, and the
 * booking card falls back to "Unknown" (see `src/components/BookingCard.tsx`),
 * which is what staff read off the floor list. So the app asks for a name
 * once, and both ends of that ask have to agree on what counts as one —
 * hence this module rather than a regex copied into two files.
 */

export const MIN_NAME_LENGTH = 2;
export const MAX_NAME_LENGTH = 60;

export type NameValidation =
  | { ok: true; value: string }
  | { ok: false; error: string };

/**
 * Trim, collapse runs of whitespace, and check it could plausibly be a name.
 * Deliberately permissive about script and punctuation — the only real
 * rejections are "empty", "too long", and "no letters in it at all".
 */
export function normalizeDisplayName(input: unknown): NameValidation {
  const value = String(input ?? '').trim().replace(/\s+/g, ' ');

  if (value.length < MIN_NAME_LENGTH) {
    return { ok: false, error: 'Please enter your name.' };
  }
  if (value.length > MAX_NAME_LENGTH) {
    return { ok: false, error: `Please keep it under ${MAX_NAME_LENGTH} characters.` };
  }
  if (!/\p{L}/u.test(value)) {
    return { ok: false, error: 'Please enter your name using letters.' };
  }

  return { ok: true, value };
}

/** True when the account still needs to be asked for a name. */
export function isMissingDisplayName(name: string | null | undefined): boolean {
  return !name || name.trim().length === 0;
}
