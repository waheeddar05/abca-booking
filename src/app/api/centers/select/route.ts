import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth';
import { findCenterById, CENTER_COOKIE } from '@/lib/centers';

/**
 * POST /api/centers/select   Body: { centerId: string }
 *
 * Sets the `selectedCenterId` cookie so subsequent requests resolve to
 * this center. Any logged-in user (or anonymous visitor) can pick any
 * active center — admin permissions are enforced per-route on actual
 * mutations, not at cookie-write time. The membership check used to
 * live here, but it broke the legitimate case of an admin-at-ABCA who
 * also wants to *book* sessions at Toplay as a regular customer.
 */
export async function POST(req: NextRequest) {
  let body: { centerId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const centerId = body.centerId;
  if (!centerId || typeof centerId !== 'string') {
    return NextResponse.json({ error: 'centerId is required' }, { status: 400 });
  }

  const center = await findCenterById(centerId);
  if (!center) {
    return NextResponse.json({ error: 'Center not found' }, { status: 404 });
  }

  const user = await getAuthenticatedUser(req);

  if (!center.isActive && !user?.isSuperAdmin) {
    return NextResponse.json({ error: 'Center is inactive' }, { status: 400 });
  }

  const res = NextResponse.json({
    centerId: center.id,
    slug: center.slug,
    name: center.name,
  });
  // 1 year — but center selection is "until manually changed" anyway.
  res.cookies.set(CENTER_COOKIE, center.id, {
    path: '/',
    sameSite: 'lax',
    maxAge: 365 * 24 * 60 * 60,
    httpOnly: false, // readable by client-side JS so admin nav can show selection without re-fetch
  });
  return res;
}
