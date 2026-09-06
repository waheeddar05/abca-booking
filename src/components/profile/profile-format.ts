/**
 * Small pure helpers for the /profile page and its components.
 *
 * Kept out of the components so the account card, the address list and
 * the address dialog all read a phone number, a failed response and a
 * signed-out response the same way.
 */

import { normalizeIndianMobile, type AddressInput, type UserAddressView } from '@/lib/addresses';

/**
 * "+91 98765 43210" for the stored 10-digit mobile. Accounts are keyed on
 * `mobileNumber`, which the OTP route stores as bare national digits; a
 * value that isn't an Indian mobile (legacy rows) is shown as typed.
 */
export function formatMobileDisplay(mobile: string | null | undefined): string | null {
  if (!mobile) return null;
  const national = normalizeIndianMobile(mobile);
  if (!national) return mobile;
  return `+91 ${national.slice(0, 5)} ${national.slice(5)}`;
}

/**
 * Up to two initials from a display name ("Virat Kohli" → "VK",
 * "Rohit" → "R"). Empty when the account has no name yet — the avatar
 * falls back to an icon rather than a "?".
 */
export function initialsOf(name: string | null | undefined): string {
  if (!name) return '';
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  // Array.from so an initial from a non-BMP script isn't split mid-glyph.
  const first = Array.from(words[0])[0] ?? '';
  const last = words.length > 1 ? (Array.from(words[words.length - 1])[0] ?? '') : '';
  return `${first}${last}`.toUpperCase();
}

/**
 * Signed-out has two shapes on `/api/user/*`: the route's own 401, and
 * the middleware redirecting an unauthenticated request to the landing
 * page — which arrives as a followed 307 with status 200 and an HTML body.
 */
export function isSignedOutResponse(res: Response): boolean {
  const isJson = res.headers.get('content-type')?.includes('application/json') ?? false;
  return res.status === 401 || res.redirected || !isJson;
}

/** The `{ error }` message from a failed JSON response, or the fallback. */
export async function readApiError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
  return typeof body?.error === 'string' && body.error ? body.error : fallback;
}

/**
 * The complete body `PATCH /api/user/addresses/[id]` expects, built from
 * a saved address. Used by "Set as default", which changes nothing but
 * the flag — the route takes the whole address so required fields can't
 * be blanked one at a time.
 */
export function toAddressPayload(address: UserAddressView, isDefault: boolean): AddressInput {
  return {
    label: address.label,
    fullName: address.fullName,
    phone: address.phone,
    line1: address.line1,
    line2: address.line2,
    landmark: address.landmark,
    city: address.city,
    state: address.state,
    pincode: address.pincode,
    isDefault,
  };
}
