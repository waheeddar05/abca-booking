import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireCenterAdmin } from '@/lib/adminAuth';
import { getAuthenticatedUser } from '@/lib/auth';
import { resolveCurrentCenter } from '@/lib/centers';

/**
 * GET /api/admin/operators
 *
 * The operator roster for the admin's current center — the list behind
 * the operator reassignment dropdown on Admin → Bookings. Mirrors
 * `/api/admin/ground-staff` and `/api/admin/sidearm-staff`: active
 * memberships for the role, priority-ordered.
 *
 * Operators are configured entirely through Admin → Operators (weekly
 * availability + priority, both stored on the CenterMembership), so this
 * route no longer writes anything. The machine-assignment endpoints
 * (POST / PUT / DELETE) and the day+slab priority PATCH that used to
 * live here are gone: operator allocation is resolved from availability
 * alone — see `src/lib/operatorAssign.ts`.
 */
export async function GET(req: NextRequest) {
  try {
    // Allow either super-admin or a center-admin AT THE RESOLVED
    // center. A user with `User.role=ADMIN` at center A can no longer
    // flip the cookie to center B and read another center's roster.
    const ctx = await requireCenterAdmin(req);
    // Full admins only — the Offers and Operators surfaces are closed
    // to moderators.
    if (!ctx || ctx.isModerator) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const allCenters = searchParams.get('allCenters') === 'true';
    const adminUser = await getAuthenticatedUser(req);
    const center = adminUser ? await resolveCurrentCenter(req, adminUser) : null;

    let centerId: string | null = null;
    if (!allCenters && center) {
      centerId = center.id;
    } else if (!allCenters && !center) {
      return NextResponse.json({ error: 'No center selected' }, { status: 400 });
    } else if (allCenters && !adminUser?.isSuperAdmin) {
      return NextResponse.json({ error: 'allCenters requires super admin' }, { status: 403 });
    }

    // Source of truth for "is this user an operator at this center" is
    // `CenterMembership(role=OPERATOR, isActive=true)` — the same
    // predicate the booking engine assigns from, so the dropdown can
    // never offer somebody the engine would reject.
    const memberships = await prisma.centerMembership.findMany({
      where: {
        role: 'OPERATOR',
        isActive: true,
        ...(centerId ? { centerId } : {}),
      },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      select: {
        user: { select: { id: true, name: true, email: true, mobileNumber: true } },
      },
    });

    // Dedupe by user id (a user can hold the role at more than one center
    // when allCenters is on) and drop rows with no user.
    const seen = new Set<string>();
    const operators = memberships
      .map((m) => m.user)
      .filter((u): u is NonNullable<typeof u> => {
        if (!u || seen.has(u.id)) return false;
        seen.add(u.id);
        return true;
      });

    return NextResponse.json({
      operators,
      // Hand the booking model to the client so the UI can render the
      // right machine picker without an extra request.
      bookingModel: center?.bookingModel ?? 'MACHINE_PITCH',
    });
  } catch (error: any) {
    console.error('Admin operators fetch error:', error);
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}
