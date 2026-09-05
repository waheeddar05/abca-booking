/**
 * Where a signed-out visitor is sent to sign in, and where they land after.
 *
 * `/login` is a bare redirect to `/`; the login form is the modal on the
 * landing page. A page that needs the visitor signed in (the shop's
 * "Notify me", a delivery-address prompt) links to `/?login=1&next=<path>`:
 * the landing page opens the modal on arrival and, once the code is
 * verified, sends the visitor back to `next` instead of the default
 * booking screen.
 *
 * `next` is only ever a same-origin path: an absolute URL, a
 * protocol-relative `//evil.example` or anything with whitespace is
 * dropped so the login flow can never be turned into an open redirect.
 */

export const DEFAULT_POST_LOGIN_PATH = '/slots';

export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  if (raw.length > 500) return null;
  if (!raw.startsWith('/')) return null;
  if (raw.startsWith('//') || raw.startsWith('/\\')) return null;
  if (/\s/.test(raw)) return null;
  // Sending someone back to the landing page after login would just
  // bounce them to /slots anyway; treat it as "no preference".
  if (raw === '/' || raw.startsWith('/?')) return null;
  return raw;
}

/** The landing-page login link, optionally returning to `next` afterwards. */
export function loginHref(next?: string | null): string {
  const safe = safeNextPath(next);
  return safe ? `/?login=1&next=${encodeURIComponent(safe)}` : '/?login=1';
}
