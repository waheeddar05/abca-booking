import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth';
import { resolveCurrentCenter } from '@/lib/centers';

/**
 * GET /api/staff/me
 *
 * Returns the staff roles the authenticated user holds at the
 * current center. The staff page uses this to render only the
 * tabs the user actually has access to (operator / coach / sidearm).
 *
 * Admins and super-admins see every role, since they can use
 * `viewAll=true` against /api/staff/bookings to see everything.
 */
export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const center = await resolveCurrentCenter(req, user);
  if (!center) {
    return NextResponse.json({ error: 'No center selected' }, { status: 400 });
  }

  const isAdmin =
    user.isSuperAdmin ||
    user.role === 'ADMIN' ||
    user.centerMemberships.some((m) => m.centerId === center.id && m.role === 'ADMIN');

  const memberships = user.centerMemberships.filter((m) => m.centerId === center.id);
  const allRoles = ['OPERATOR', 'COACH', 'SIDEARM_SPECIALIST'] as const;
  const roles = isAdmin
    ? Array.from(allRoles)
    : allRoles.filter((r) => memberships.some((m) => m.role === r));

  return NextResponse.json({
    userId: user.id,
    userName: user.name ?? null,
    centerId: center.id,
    centerName: center.name,
    isAdmin,
    roles,
  });
}
