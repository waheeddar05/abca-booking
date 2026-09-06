/**
 * The custom OTP session token — signed on the WhatsApp login and read by
 * every gate that decides whether someone is signed in.
 *
 * Signed and verified with `jose`, NOT `jsonwebtoken`, and that choice is
 * load-bearing rather than cosmetic. `src/middleware.ts` is the app's edge
 * middleware: it runs in Vercel's Edge Runtime, where Node's `crypto` module
 * does not exist. `jsonwebtoken` reaches `crypto.createHmac` through `jws`,
 * so on the edge every `verify()` threw and the old wrapper's `catch` turned
 * that into `null` — "not signed in" for every WhatsApp user, on every
 * request, while `src/app/page.tsx` (Node runtime, same helper, same cookie)
 * read the same token successfully and redirected them to /slots. The two
 * runtimes disagreeing about one cookie is an infinite / <-> /slots redirect
 * loop, which is exactly what shipped on 2026-09-02.
 *
 * `jose` is built on Web Crypto, so it behaves identically in the Edge
 * Runtime, in Node serverless functions and in tests. Anything that decides
 * "is this request authenticated" must stay on it.
 *
 * The format is unchanged (HS256 over the same `JWT_SECRET`), so tokens
 * issued by the previous `jsonwebtoken` implementation keep verifying and
 * nobody is signed out by this change.
 */

import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

const ALGORITHM = 'HS256';
const EXPIRES_IN = '7d';

/**
 * Encoded once at module load. `TextEncoder` produces the same UTF-8 bytes
 * `jsonwebtoken` used for the HMAC key, which is what keeps already-issued
 * tokens valid.
 */
const secretKey = new TextEncoder().encode(process.env.JWT_SECRET || 'fallback-secret');

/** Claims this app puts in the session token. */
export interface SessionTokenPayload extends JWTPayload {
  userId: string;
  name?: string | null;
  email?: string | null;
  mobileNumber?: string | null;
  role?: string;
  mobileVerified?: boolean;
  /**
   * Platform-level grants, so the middleware can route a store admin who
   * is otherwise a plain USER into /admin/shop and keep a center admin
   * out of it. Absent on tokens issued before these claims existed; the
   * middleware treats "absent" as unknown and leaves it to the API guard.
   */
  isSuperAdmin?: boolean;
  isStoreAdmin?: boolean;
}

export async function signToken(payload: SessionTokenPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuedAt()
    .setExpirationTime(EXPIRES_IN)
    .sign(secretKey);
}

/**
 * Verify a session token. Returns the claims, or `null` when the token is
 * missing, malformed, expired or not signed by us — callers treat `null` as
 * "not signed in".
 *
 * `algorithms` is pinned so a token can't ask to be verified under a weaker
 * algorithm than the one we sign with.
 */
export async function verifyToken(token: string): Promise<SessionTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey, { algorithms: [ALGORITHM] });
    return payload as SessionTokenPayload;
  } catch {
    return null;
  }
}
