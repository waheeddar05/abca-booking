import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, canAccessCenter } from '@/lib/auth';
import { findCenterById, CENTER_COOKIE } from '@/lib/centers';

/**
 * POST /api/centers/select   Body: { centerId: string }
 *
 * Sets the `selectedCenterId` cookie so subsequent requests resolve to
 * this center. Anyone may select an active center (the user-facing flow
 * needs this), but admins/operators are blocked from selecting a center
 * they don't have a membership at — preventing accidental cross-center
 * mutations from a single account.
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

  // Admins/operators are scoped to their memberships. Plain users and
  // anonymous visitors can pick any active center (they're just browsing).
  if (user && (user.role === 'ADMIN' || user.role === 'OPERATOR')) {
    if (!canAccessCenter(user, center.id)) {
      return NextResponse.json(
        { error: 'You are not a member of this center' },
        { status: 403 },
      );
    }
  }

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
