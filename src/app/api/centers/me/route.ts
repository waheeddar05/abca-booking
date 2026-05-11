import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';
import { listUserCenters, resolveCurrentCenter, CENTER_COOKIE } from '@/lib/centers';
import { sanitizeApiError } from '@/lib/api-errors';

/**
 * GET /api/centers/me[?audience=admin]
 *
 * Returns the centers visible to the current user, plus the currently-
 * selected center based on cookie/query/default resolution.
 *
 * audience=user (default) — every active center. Used by the public
 *   user-side selector (in the Navbar). Centers are public; permissions
 *   are enforced per-route.
 * audience=admin — only the centers where the current user holds an
 *   ADMIN membership (super admins still see every active center).
 *   Used by the admin sidebar switcher so an ABCA admin can't accidentally
 *   start editing Toplay's data via a cookie flip.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    const audience = new URL(req.url).searchParams.get('audience') === 'admin' ? 'admin' : 'user';

    const centers =
      audience === 'admin'
        ? await listAdminCenters(user)
        : await listUserCenters(user);
    const current = await resolveCurrentCenter(req, user);

    const adminCenterIds = user
      ? user.centerMemberships.filter((m) => m.role === 'ADMIN').map((m) => m.centerId)
      : [];
    const staffCenterIds = user
      ? user.centerMemberships
          .filter((m) => m.role === 'OPERATOR' || m.role === 'COACH' || m.role === 'SIDEARM_SPECIALIST')
          .map((m) => m.centerId)
      : [];

    return NextResponse.json({
      user: user
        ? {
            id: user.id,
            role: user.role,
            isSuperAdmin: user.isSuperAdmin,
            adminCenterIds,
            staffCenterIds,
          }
        : null,
      centers,
      currentCenterId: current?.id ?? null,
      cookieName: CENTER_COOKIE,
    });
  } catch (error) {
    // Critical path — when this 500s, the user app blanks out. Sanitize
    // (so a Neon cold-start stack trace doesn't leak) and return a
    // graceful empty payload so the client just shows the loading state
    // and retries on its own.
    const { message, status } = sanitizeApiError(
      error,
      'centers.me',
      'Could not load centers. Please try again.',
    );
    return NextResponse.json({ error: message }, { status });
  }
}

/**
 * Centers the current user can administer:
 *   - super admins → every active center
 *   - admins → only the centers where they hold an ADMIN membership
 *   - everyone else → empty list (admin sidebar will hide the switcher)
 */
async function listAdminCenters(user: Awaited<ReturnType<typeof getAuthenticatedUser>>) {
  if (!user) return [];
  if (user.isSuperAdmin) {
    return prisma.center.findMany({
      where: { isActive: true },
      orderBy: { displayOrder: 'asc' },
      select: { id: true, slug: true, name: true, shortName: true, isActive: true, bookingModel: true },
    });
  }
  const adminCenterIds = user.centerMemberships
    .filter((m) => m.role === 'ADMIN')
    .map((m) => m.centerId);
  if (adminCenterIds.length === 0) return [];
  return prisma.center.findMany({
    where: { id: { in: adminCenterIds }, isActive: true },
    orderBy: { displayOrder: 'asc' },
    select: { id: true, slug: true, name: true, shortName: true, isActive: true, bookingModel: true },
  });
}
