import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth';
import { listUserCenters, resolveCurrentCenter, CENTER_COOKIE } from '@/lib/centers';
import { sanitizeApiError } from '@/lib/api-errors';

/**
 * GET /api/centers/me
 *
 * Returns the centers visible to the current user (memberships, or all
 * active centers for super admins / anonymous public visitors), plus the
 * currently-selected center based on cookie/query/default resolution.
 *
 * Used by the admin header center switcher and the user-side selector.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    const centers = await listUserCenters(user);
    const current = await resolveCurrentCenter(req, user);

    return NextResponse.json({
      user: user
        ? { id: user.id, role: user.role, isSuperAdmin: user.isSuperAdmin }
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
