/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME, clearSessionCookie, setSessionCookie } from '@/lib/session-cookie';

describe('session cookie', () => {
  it('is SameSite=Lax, not Strict', () => {
    const res = NextResponse.json({});
    setSessionCookie(res, 'a.b.c');

    // Strict withholds the cookie on any top-level navigation that started
    // on another site — a link tapped in WhatsApp, a QR code, a search
    // result, a PWA launch — so the server renders `/` for a signed-out
    // visitor and a signed-in user is shown the landing page.
    expect(res.cookies.get(SESSION_COOKIE_NAME)?.sameSite).toBe('lax');
  });

  it('is httpOnly, site-wide, and lives as long as the token', () => {
    const res = NextResponse.json({});
    setSessionCookie(res, 'a.b.c');
    const cookie = res.cookies.get(SESSION_COOKIE_NAME);

    expect(cookie?.value).toBe('a.b.c');
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.path).toBe('/');
    expect(cookie?.maxAge).toBe(7 * 24 * 60 * 60);
  });

  it('clears with attributes that match the ones it was set with', () => {
    const set = NextResponse.json({});
    setSessionCookie(set, 'a.b.c');
    const cleared = NextResponse.json({});
    clearSessionCookie(cleared);

    const a = set.cookies.get(SESSION_COOKIE_NAME);
    const b = cleared.cookies.get(SESSION_COOKIE_NAME);

    // Sign-out only works if name, path and the rest line up.
    expect(b?.name).toBe(a?.name);
    expect(b?.path).toBe(a?.path);
    expect(b?.sameSite).toBe(a?.sameSite);
    expect(b?.httpOnly).toBe(a?.httpOnly);
    expect(b?.value).toBe('');
    expect(b?.maxAge).toBe(0);
  });
});
