import { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { verifyToken } from '@/lib/jwt';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser, hasMembershipRole, isCenterModerator } from '@/lib/auth';
import { resolveCurrentCenter } from '@/lib/centers';

const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || process.env.INITIAL_ADMIN_EMAIL || '';

export async function getAdminSession(req: NextRequest) {
  let email: string | null = null;

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (token?.email) {
    email = token.email;
  } else {
    const otpTokenStr = req.cookies.get('token')?.value;
    if (otpTokenStr) {
      try {
        const otpToken = verifyToken(otpTokenStr) as any;
        email = otpToken?.email || null;
      } catch {
        return null;
      }
    }
  }

  if (!email) return null;

  // Always fetch the current role from DB so admin-promoted roles take effect immediately
  const dbUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true, role: true, isSuperAdmin: true },
  });
  if (!dbUser) return null;

  // Compute super-admin from DB column with bootstrap email fallback.
  const isSuperAdmin =
    dbUser.isSuperAdmin || (!!SUPER_ADMIN_EMAIL && email === SUPER_ADMIN_EMAIL);

  return { id: dbUser.id, role: dbUser.role, email, isSuperAdmin };
}

export async function requireAdmin(req: NextRequest) {
  const session = await getAdminSession(req);
  // MODERATOR is a restricted admin. This coarse guard fronts read-only
  // / export endpoints (stats, reports, export) that moderators ARE
  // allowed to use, so they pass here. Endpoints that a moderator must
  // NOT reach keep a stricter check of their own.
  if (session?.role !== 'ADMIN' && session?.role !== 'MODERATOR') return null;
  return session;
}

/**
 * Stricter than `requireAdmin`. Resolves the currently-active center
 * (cookie / membership) and only succeeds if the caller is either:
 *   - a super admin (cross-center), or
 *   - a center-level admin with an active CenterMembership(role=ADMIN)
 *     at the resolved center.
 *
 * Returns `{ user, center }` on success or `null` on failure. Callers
 * turn null into a 401/403 response of their choice.
 *
 * Use this for every day-to-day admin endpoint that operates on a
 * specific center (bookings, slots, packages, offers, operators,
 * refunds, …). The legacy `requireAdmin` only checks the global
 * `User.role` flag, which lets a global admin who isn't a member of
 * Center B switch the cookie to Center B and act as if they were an
 * admin there — exactly what we don't want when each center is run
 * by an independent operator.
 */
export async function requireCenterAdmin(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user) return null;
  // Global "ADMIN"/"MODERATOR" is still required as a coarse gate; this
  // catches OPERATOR / COACH / SIDEARM_SPECIALIST users early. MODERATOR
  // is admitted here (it's a restricted admin) — routes that a moderator
  // must not perform gate on the `isModerator` flag returned below.
  if (user.role !== 'ADMIN' && user.role !== 'MODERATOR' && !user.isSuperAdmin) return null;
  const center = await resolveCurrentCenter(req, user);
  if (!center) return null;
  if (user.isSuperAdmin) {
    return { user, center, isModerator: false };
  }
  if (
    !hasMembershipRole(user, center.id, 'ADMIN') &&
    !hasMembershipRole(user, center.id, 'MODERATOR')
  ) {
    return null;
  }
  return { user, center, isModerator: isCenterModerator(user, center.id) };
}

/**
 * Allow only super admins. Use for cross-center operations:
 * managing centers, machine catalog, super-admin-only data fixes.
 */
export async function requireSuperAdmin(req: NextRequest) {
  const session = await getAdminSession(req);
  if (!session?.isSuperAdmin) return null;
  return session;
}

/**
 * Allow super admins OR center admins of the given centerId. Use for
 * endpoints that manage a SPECIFIC center's own data (its members,
 * resources, machines, policies, profile) — the things a center admin
 * should be able to run independently.
 *
 * Returns `{ user, isSuperAdmin }` on success or `null` on failure.
 * Callers should turn null into a 403.
 *
 * This is intentionally different from `requireCenterAdmin`, which
 * resolves the "current" center from cookie/membership. Here the
 * centerId is explicit (from the URL), which is what we want for
 * `/api/admin/centers/[id]/*` routes.
 */
export async function requireCenterAdminForCenter(req: NextRequest, centerId: string) {
  const user = await getAuthenticatedUser(req);
  if (!user) return null;
  if (user.isSuperAdmin) return { user, isSuperAdmin: true as const };
  // Global ADMIN gate first, then check membership at THIS center.
  if (user.role !== 'ADMIN') return null;
  if (!hasMembershipRole(user, centerId, 'ADMIN')) return null;
  return { user, isSuperAdmin: false as const };
}

export async function requireOperatorOrAdmin(req: NextRequest) {
  const session = await getAdminSession(req);
  if (!session?.role || !['ADMIN', 'OPERATOR'].includes(session.role)) return null;
  return session;
}

export async function getOperatorSession(req: NextRequest) {
  const session = await getAdminSession(req);
  if (!session?.role || !['ADMIN', 'OPERATOR'].includes(session.role)) return null;
  const user = await prisma.user.findUnique({
    where: { email: session.email },
    select: { id: true },
  });
  if (!user) return null;
  return { ...session, userId: user.id, isAdmin: session.role === 'ADMIN' };
}
