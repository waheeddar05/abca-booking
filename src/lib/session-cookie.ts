import type { NextResponse } from 'next/server';

/**
 * The OTP session cookie — one definition, so the route that issues it and
 * the route that clears it cannot drift apart.
 *
 * `sameSite` is **lax**, not strict, and that is a deliberate correction.
 * Strict withholds the cookie on any top-level navigation that started on
 * another site: a link tapped in WhatsApp, an Instagram bio link, a QR code,
 * a search result, a PWA launch. `src/app/page.tsx` then renders for a
 * signed-out visitor and the user — who is signed in, and whose very next
 * same-site fetch proves it — is shown the landing page instead of their
 * booking screen. Lax still withholds the cookie from cross-site POSTs,
 * which is the CSRF protection that actually matters here.
 */
export const SESSION_COOKIE_NAME = 'token';

/** 7 days, matching the JWT's own expiry. */
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

const BASE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
} as const;

/** Attach a freshly issued session to a response. */
export function setSessionCookie(response: NextResponse, token: string) {
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    ...BASE_OPTIONS,
    maxAge: MAX_AGE_SECONDS,
  });
}

/**
 * Expire the session. The attributes have to match the ones it was set with
 * on name, path and domain, or the browser keeps the original cookie.
 */
export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE_NAME, '', {
    ...BASE_OPTIONS,
    maxAge: 0,
  });
}
