import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';
import { resolveCurrentCenter } from '@/lib/centers';

/**
 * Resolve the *own* COACH membership for the authenticated user at the
 * current center.
 *
 * User-facing sibling of `resolveOwnSidearmMembership` (`src/lib/sidearm.ts`).
 * Used by the user-facing Personal Coach tab (`/coach` + `/api/coach/*`),
 * where a coach manages their own availability. The membership is always
 * derived server-side from the authenticated user + resolved center —
 * never from a client-supplied id — so a coach can only ever touch their
 * own schedule.
 *
 * Returns:
 *   - `{ ok: true, user, centerId, membership }` when the user holds an
 *     active COACH membership at the current center.
 *   - `{ ok: false, status, error }` otherwise (401 not signed in,
 *     400 no center, 403 not a coach here).
 */
export async function resolveOwnCoachMembership(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return { ok: false as const, status: 401, error: 'Unauthorized' };
  }

  const center = await resolveCurrentCenter(req, user);
  if (!center) {
    return { ok: false as const, status: 400, error: 'No center selected' };
  }

  const membership = await prisma.centerMembership.findFirst({
    where: {
      userId: user.id,
      centerId: center.id,
      role: 'COACH',
      isActive: true,
    },
    select: { id: true, centerId: true, role: true },
  });

  if (!membership) {
    return {
      ok: false as const,
      status: 403,
      error: 'You are not a coach at this center',
    };
  }

  return { ok: true as const, user, centerId: center.id, membership };
}
