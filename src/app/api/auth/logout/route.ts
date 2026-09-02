import { NextResponse } from 'next/server';

/**
 * POST /api/auth/logout — end a WhatsApp (OTP JWT) session.
 *
 * The `token` cookie is httpOnly, so the client cannot clear it: the two
 * places that tried (`document.cookie = 'token=; …'` in the navbar and the
 * staff layout) never removed anything, and the user stayed signed in
 * through a "Sign out" they had already been shown. Only the server can
 * expire it, which is what this does.
 *
 * Public: clearing your own cookie needs no session, and a request with no
 * cookie is a harmless no-op.
 */
export async function POST() {
  const response = NextResponse.json({ message: 'Signed out' });
  // Same attributes the cookie was set with in /api/auth/otp/verify —
  // a Set-Cookie that differs on path or sameSite may not replace it.
  response.cookies.set('token', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 0,
    path: '/',
  });
  return response;
}
