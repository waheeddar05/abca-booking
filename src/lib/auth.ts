import { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/jwt';
import type { MembershipRole } from '@prisma/client';

// Bootstrap super-admin email — used as a fallback if the User row
// doesn't have isSuperAdmin set yet (first sign-in for a fresh DB).
// The DB column is the source of truth from now on.
const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || process.env.INITIAL_ADMIN_EMAIL || '';

// Minimal select for auth — only fetch the fields we actually return.
const AUTH_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  isSuperAdmin: true,
  isFreeUser: true,
  isSpecialUser: true,
  mobileVerified: true,
  centerMemberships: {
    where: { isActive: true },
    select: {
      centerId: true,
      role: true,
    },
  },
} as const;

export interface CenterMembershipSummary {
  centerId: string;
  role: MembershipRole;
}

export interface AuthenticatedUser {
  id: string;
  name?: string;
  role: string;
  email?: string;
  isSuperAdmin: boolean;
  isFreeUser: boolean;
  isSpecialUser: boolean;
  mobileVerified: boolean;
  /** Centers the user has any active membership at. Empty for plain end-users. */
  centerIds: string[];
  /** Full membership rows so callers can ask "is this user an admin at center X?". */
  centerMemberships: CenterMembershipSummary[];
}

type DbAuthUser = {
  id: string;
  name: string | null;
  email: string | null;
  role: string;
  isSuperAdmin: boolean;
  isFreeUser: boolean;
  isSpecialUser: boolean;
  mobileVerified: boolean;
  centerMemberships: CenterMembershipSummary[];
};

function toAuthenticatedUser(dbUser: DbAuthUser): AuthenticatedUser {
  // Compute super-admin from DB column, with email fallback for the
  // bootstrap case (DB column not yet flipped, but env identifies them).
  const isSuperAdmin =
    dbUser.isSuperAdmin ||
    !!(dbUser.email && SUPER_ADMIN_EMAIL && dbUser.email === SUPER_ADMIN_EMAIL);

  const centerIds = Array.from(
    new Set(dbUser.centerMemberships.map((m) => m.centerId)),
  );

  return {
    id: dbUser.id,
    name: dbUser.name || undefined,
    role: dbUser.role,
    email: dbUser.email || undefined,
    isSuperAdmin,
    isFreeUser: dbUser.isFreeUser || false,
    isSpecialUser: dbUser.isSpecialUser || false,
    mobileVerified: dbUser.mobileVerified || false,
    centerIds,
    centerMemberships: dbUser.centerMemberships,
  };
}

export async function getAuthenticatedUser(req: NextRequest): Promise<AuthenticatedUser | null> {
  // 1. Try NextAuth JWT first (local decode, no HTTP request — ~1ms vs ~500ms for getServerSession)
  const nextAuthToken = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (nextAuthToken?.email) {
    const dbUser = await prisma.user.findUnique({
      where: { email: nextAuthToken.email },
      select: AUTH_USER_SELECT,
    });
    if (dbUser) return toAuthenticatedUser(dbUser as DbAuthUser);
  }

  // 2. Fallback to custom OTP JWT
  const otpTokenStr = req.cookies.get('token')?.value;
  if (otpTokenStr) {
    const decoded = verifyToken(otpTokenStr) as any;
    if (decoded?.userId) {
      const dbUser = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: AUTH_USER_SELECT,
      });
      if (dbUser) return toAuthenticatedUser(dbUser as DbAuthUser);
    }
  }

  return null;
}

// ─── Center scoping helpers ─────────────────────────────────────────

/**
 * True if the user is allowed to act on data at the given center —
 * either because they're a super admin, or because they hold any active
 * membership there.
 *
 * USE THIS in every API route that mutates or reads center-scoped data.
 * Combine with explicit role check (e.g. require ADMIN membership) when
 * the route is admin-only.
 */
export function canAccessCenter(user: AuthenticatedUser, centerId: string): boolean {
  if (user.isSuperAdmin) return true;
  return user.centerMemberships.some((m) => m.centerId === centerId);
}

export function hasMembershipRole(
  user: AuthenticatedUser,
  centerId: string,
  role: MembershipRole,
): boolean {
  if (user.isSuperAdmin) return true;
  return user.centerMemberships.some((m) => m.centerId === centerId && m.role === role);
}

/**
 * Center IDs the user can administer. Super admins return [] — callers
 * should treat that as "all centers" via a separate branch, since we
 * don't know the full list here without an extra query.
 */
export function adminCenterIds(user: AuthenticatedUser): string[] {
  return user.centerMemberships
    .filter((m) => m.role === 'ADMIN')
    .map((m) => m.centerId);
}
