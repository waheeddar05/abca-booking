import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireCenterAdmin } from '@/lib/adminAuth';
import { getAuthenticatedUser } from '@/lib/auth';
import { resolveCurrentCenter } from '@/lib/centers';

/**
 * GET /api/admin/sidearm-staff
 *
 * Lists the sidearm specialists (active SIDEARM_SPECIALIST memberships)
 * at the admin's current center. Powers the booking-detail reassignment
 * dropdown, mirroring `/api/admin/operators` for operators.
 *
 * Super admins may pass `?allCenters=true` to list specialists across
 * every center.
 */
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

    const staff = await prisma.user.findMany({
      where: {
        centerMemberships: {
          some: centerId
            ? { centerId, role: 'SIDEARM_SPECIALIST', isActive: true }
            : { role: 'SIDEARM_SPECIALIST', isActive: true },
        },
      },
      select: { id: true, name: true, email: true, mobileNumber: true },
      orderBy: { name: 'asc' },
    });

    return NextResponse.json({
      staff: staff.map((s) => ({ id: s.id, name: s.name || s.email || s.mobileNumber || 'Specialist' })),
    });
  } catch (error: any) {
    console.error('Admin sidearm-staff fetch error:', error);
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}
