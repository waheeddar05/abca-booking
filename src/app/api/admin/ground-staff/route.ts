import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireCenterAdmin } from '@/lib/adminAuth';
import { getAuthenticatedUser } from '@/lib/auth';
import { resolveCurrentCenter } from '@/lib/centers';

// GET: List the ground-staff members (CenterMembership role GROUND_STAFF)
// for the admin's current center. Mirrors `/api/admin/sidearm-staff` so the
// admin Bookings page can offer a ground-staff reassignment dropdown for
// Cricket Net / Full Court / Corporate Batch bookings exactly like the
// operator and sidearm ones. Returns `{ staff: [{ id, name, mobileNumber }] }`,
// priority-ordered.
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireCenterAdmin(req);
    if (!ctx) {
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

    const memberships = await prisma.centerMembership.findMany({
      where: {
        role: 'GROUND_STAFF',
        isActive: true,
        ...(centerId ? { centerId } : {}),
      },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      select: {
        user: { select: { id: true, name: true, email: true, mobileNumber: true } },
      },
    });

    // Dedupe by user id (a user could hold the role at more than one center
    // when allCenters is on) and drop rows with no user.
    const seen = new Set<string>();
    const staff = memberships
      .map((m) => m.user)
      .filter((u): u is NonNullable<typeof u> => {
        if (!u || seen.has(u.id)) return false;
        seen.add(u.id);
        return true;
      })
      .map((u) => ({
        id: u.id,
        name: u.name || u.email || u.mobileNumber || 'Ground Staff',
        mobileNumber: u.mobileNumber,
      }));

    return NextResponse.json({ staff });
  } catch (error: any) {
    console.error('Admin ground-staff fetch error:', error);
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}
