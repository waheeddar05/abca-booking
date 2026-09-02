/**
 * @vitest-environment node
 *
 * Node, not the project-default jsdom: this file exercises server-side auth
 * code, and jsdom's `TextEncoder` returns a Uint8Array from a different realm,
 * which `jose` rejects. Node is also the closer analogue of where this code
 * actually runs.
 */
/**
 * Regression tests for the OTP session token and the gates that read it.
 *
 * The bug these exist to prevent: `@/lib/jwt` was implemented with
 * `jsonwebtoken`, which needs Node's `crypto`. `src/middleware.ts` runs in
 * the Edge Runtime, where that module does not exist, so `verifyToken` threw
 * there and was caught into `null` — middleware saw every WhatsApp user as
 * signed out and bounced them from /slots back to /, while `src/app/page.tsx`
 * (Node runtime) read the same cookie fine and redirected them to /slots.
 * Result: an infinite redirect loop, i.e. nobody could log in.
 *
 * So the invariants are: the token must round-trip, tokens issued by the old
 * implementation must keep verifying (nobody gets signed out by the fix), and
 * middleware must treat a valid OTP cookie as signed in.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';

process.env.JWT_SECRET = 'test-secret-for-session-tokens';
process.env.NEXTAUTH_SECRET = 'test-nextauth-secret';

// Middleware must see no NextAuth session, so the OTP cookie is the only
// thing that can authenticate the request — exactly the production shape.
vi.mock('next-auth/jwt', () => ({ getToken: vi.fn(async () => null) }));

type Jwt = typeof import('@/lib/jwt');
type Middleware = typeof import('@/middleware');

let signToken: Jwt['signToken'];
let verifyToken: Jwt['verifyToken'];
let middleware: Middleware['middleware'];
let NextRequest: typeof import('next/server').NextRequest;
let legacySign: (payload: object, secret: string, opts: object) => string;

const SESSION = {
  userId: 'usr_abc123',
  name: null,
  email: null,
  mobileNumber: '9876543210',
  role: 'USER',
  mobileVerified: true,
};

beforeAll(async () => {
  ({ signToken, verifyToken } = await import('@/lib/jwt'));
  ({ middleware } = await import('@/middleware'));
  ({ NextRequest } = await import('next/server'));
  const jwt = (await import('jsonwebtoken')).default;
  legacySign = (payload, secret, opts) => jwt.sign(payload, secret, opts);
});

function requestWithToken(path: string, token?: string) {
  const req = new NextRequest(`https://www.playorbit.in${path}`);
  if (token) req.cookies.set('token', token);
  return req;
}

describe('session token', () => {
  it('round-trips the claims the middleware and API guards read', async () => {
    const decoded = await verifyToken(await signToken(SESSION));

    expect(decoded).not.toBeNull();
    expect(decoded?.userId).toBe(SESSION.userId);
    expect(decoded?.role).toBe('USER');
    expect(decoded?.mobileVerified).toBe(true);
    expect(decoded?.mobileNumber).toBe('9876543210');
  });

  it('verifies tokens minted by the previous jsonwebtoken implementation', async () => {
    // Same HS256 secret, same claim shape — this is what every user who
    // logged in before the fix is still holding in their `token` cookie.
    const legacy = legacySign(SESSION, process.env.JWT_SECRET as string, { expiresIn: '7d' });

    expect((await verifyToken(legacy))?.userId).toBe(SESSION.userId);
  });

  it('rejects a token signed with a different secret', async () => {
    const forged = legacySign(SESSION, 'not-our-secret', { expiresIn: '7d' });

    expect(await verifyToken(forged)).toBeNull();
  });

  it('rejects an expired token', async () => {
    const expired = legacySign(SESSION, process.env.JWT_SECRET as string, { expiresIn: -60 });

    expect(await verifyToken(expired)).toBeNull();
  });

  it('rejects a malformed token instead of throwing', async () => {
    expect(await verifyToken('not.a.jwt')).toBeNull();
    expect(await verifyToken('')).toBeNull();
  });
});

describe('middleware session gate', () => {
  it('lets a valid OTP session through to a protected route', async () => {
    const res = await middleware(requestWithToken('/slots', await signToken(SESSION)));

    // A 307 here is the redirect loop: middleware bouncing a signed-in user
    // back to `/`, which then redirects them to `/slots` again.
    expect(res.status).not.toBe(307);
    expect(res.headers.get('location')).toBeNull();
  });

  it('still redirects a request with no session to the landing page', async () => {
    const res = await middleware(requestWithToken('/slots'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://www.playorbit.in/');
  });

  it('does not accept a forged session cookie', async () => {
    const forged = legacySign({ ...SESSION, role: 'ADMIN' }, 'not-our-secret', { expiresIn: '7d' });

    expect((await middleware(requestWithToken('/slots', forged))).status).toBe(307);
  });

  it('sends a signed-in user away from the landing-page login routes', async () => {
    const res = await middleware(requestWithToken('/login', await signToken(SESSION)));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://www.playorbit.in/slots');
  });
});
