import { NextResponse } from 'next/server';
import { clearSessionCookie } from '@/lib/session-cookie';

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
  clearSessionCookie(response);
  return response;
}
