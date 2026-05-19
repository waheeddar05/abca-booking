/**
 * Center resolution + scoping helpers.
 *
 * The "current center" for any request is resolved as follows (first match wins):
 *   1. Explicit `?center=<slug>` query param  (super-admin / debugging)
 *   2. `selectedCenterId` cookie               (user's last choice)
 *   3. The user's first active membership      (admins/operators)
 *   4. The first active center in the system   (anonymous public pages)
 *
 * This keeps URLs stable (no path prefix, no subdomain), works in TWA/PWA
 * installs, and lets us SSR-render any page with a known center.
 */

import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { AuthenticatedUser } from '@/lib/auth';

export const CENTER_COOKIE = 'selectedCenterId';
export const CENTER_QUERY_PARAM = 'center';
export const ABCA_CENTER_ID = 'ctr_abca'; // seeded in 20260427000000_multi_center_foundation

export interface CenterSummary {
  id: string;
  slug: string;
  name: string;
  shortName: string | null;
  isActive: boolean;
  bookingModel: 'MACHINE_PITCH' | 'RESOURCE_BASED';
  description: string | null;
  // Contact + location — safe to expose publicly. The user app's
  // ContactFooter, /centers page, and meta tags all read from here.
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  latitude: number | null;
  longitude: number | null;
  contactPhone: string | null;
  /** Multi-contact list. Optional — readers fall back to a one-entry
   *  list synthesised from contactPhone when missing. Each entry is
   *  { name: string | null, number: string }. */
  contactPhones?: Array<{ name: string | null; number: string }> | null;
  contactEmail: string | null;
  mapUrl: string | null;
  logoUrl: string | null;
  themeColor: string | null;
}

/**
 * Resolve the active center for a request. Used inside API routes and
 * Server Components.
 *
 * @param req     Next request (for query/cookies). Pass null inside
 *                Server Components where you only have `cookies()`.
 * @param user    Authenticated user, if any. Used for membership-based
 *                fallback. Super admins are not auto-pinned to a center —
 *                they pick via cookie/query like everyone else.
 */
export async function resolveCurrentCenter(
  req: NextRequest | null,
  user: AuthenticatedUser | null,
): Promise<CenterSummary | null> {
  // 1. Query param: `?center=<slug>`
  const slug = req?.nextUrl.searchParams.get(CENTER_QUERY_PARAM);
  if (slug) {
    const c = await findCenterBySlug(slug);
    if (c && (c.isActive || user?.isSuperAdmin)) return c;
  }

  // 2. Cookie
  const cookieId = req
    ? req.cookies.get(CENTER_COOKIE)?.value
    : (await cookies()).get(CENTER_COOKIE)?.value;
  if (cookieId) {
    const c = await findCenterById(cookieId);
    if (c && (c.isActive || user?.isSuperAdmin)) return c;
  }

  // 3. User's first membership (admins/operators/coaches/staff)
  if (user && user.centerIds.length > 0) {
    const c = await findCenterById(user.centerIds[0]);
    if (c) return c;
  }

  // 4. Default to the first active center, ordered by displayOrder.
  return findDefaultCenter();
}

export async function findCenterBySlug(slug: string): Promise<CenterSummary | null> {
  return prisma.center.findUnique({
    where: { slug },
    select: centerSummarySelect,
  }) as Promise<CenterSummary | null>;
}

export async function findCenterById(id: string): Promise<CenterSummary | null> {
  return prisma.center.findUnique({
    where: { id },
    select: centerSummarySelect,
  }) as Promise<CenterSummary | null>;
}

export async function findDefaultCenter(): Promise<CenterSummary | null> {
  return prisma.center.findFirst({
    where: { isActive: true },
    orderBy: { displayOrder: 'asc' },
    select: centerSummarySelect,
  }) as Promise<CenterSummary | null>;
}

/**
 * Return centers the user can pick from in any center switcher.
 *
 * Centers are inherently public (the /centers page already lists them all
 * to anonymous visitors), and a user who happens to be an admin at ABCA
 * is still a customer who might want to book at Toplay. So we return
 * every active center to logged-in users regardless of their membership
 * scope. Permissions for admin-only routes are enforced at the API
 * layer — switching the cookie can't grant access on its own.
 */
export async function listUserCenters(
  // Kept in the signature so callers don't need to update — the user
  // argument is no longer used now that every logged-in viewer sees
  // every active center.
  user: AuthenticatedUser | null,
): Promise<CenterSummary[]> {
  void user;
  return prisma.center.findMany({
    where: { isActive: true },
    orderBy: { displayOrder: 'asc' },
    select: centerSummarySelect,
  }) as Promise<CenterSummary[]>;
}

/**
 * Distance helper (Haversine, km). Used by the auto-suggest flow to pick
 * the nearest center for a given user location.
 */
export function distanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371; // Earth radius (km)
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const centerSummarySelect = {
  id: true,
  slug: true,
  name: true,
  shortName: true,
  isActive: true,
  bookingModel: true,
  description: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  state: true,
  pincode: true,
  latitude: true,
  longitude: true,
  contactPhone: true,
  contactPhones: true,
  contactEmail: true,
  mapUrl: true,
  logoUrl: true,
  themeColor: true,
} as const;
