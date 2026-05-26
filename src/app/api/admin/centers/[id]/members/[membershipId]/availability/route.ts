import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser, hasMembershipRole } from '@/lib/auth';
import { sanitizeApiError } from '@/lib/api-errors';
import { autoCancelImpactedBookings } from '@/lib/availability-sync';

/**
 * Weekly recurring availability schedule for a coach or sidearm
 * specialist membership.
 *
 *   GET  /api/admin/centers/[id]/members/[membershipId]/availability
 *   PUT  /api/admin/centers/[id]/members/[membershipId]/availability
 *
 * GET returns the current rows (sorted by day-of-week then startTime).
 * PUT does a full replace — the body's `windows` array becomes the
 * canonical schedule, all previous rows are deleted, atomic in one
 * transaction. Empty array clears the schedule (which means "always
 * available" per the engine's default).
 *
 * Auth: must be admin at this center, or super admin. Membership's
 * role must be COACH or SIDEARM_SPECIALIST — availability for ADMIN /
 * OPERATOR is not modeled.
 */

type Params = { id: string; membershipId: string };

const TIME_HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const WindowSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().regex(TIME_HHMM, 'Use HH:MM (24h)'),
  endTime:   z.string().regex(TIME_HHMM, 'Use HH:MM (24h)'),
}).refine((w) => w.endTime > w.startTime, {
  message: 'endTime must be after startTime',
  path: ['endTime'],
});

const PutSchema = z.object({
  windows: z.array(WindowSchema).max(50),
});

async function loadMembership(centerId: string, membershipId: string) {
  return prisma.centerMembership.findUnique({
    where: { id: membershipId },
    select: { id: true, centerId: true, role: true, isActive: true },
  }).then((m) => (m && m.centerId === centerId ? m : null));
}

export async function GET(req: NextRequest, ctx: { params: Promise<Params> }) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user || (user.role !== 'ADMIN' && !user.isSuperAdmin)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }
    const { id: centerId, membershipId } = await ctx.params;
    if (!user.isSuperAdmin && !hasMembershipRole(user, centerId, 'ADMIN')) {
      return NextResponse.json({ error: 'You are not an admin at this center' }, { status: 403 });
    }

    const m = await loadMembership(centerId, membershipId);
    if (!m) return NextResponse.json({ error: 'Membership not found' }, { status: 404 });
    if (m.role !== 'COACH' && m.role !== 'SIDEARM_SPECIALIST') {
      return NextResponse.json(
        { error: 'Availability is only modeled for coaches and sidearm specialists' },
        { status: 400 },
      );
    }

    const rows = await prisma.membershipAvailability.findMany({
      where: { membershipId, isActive: true },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
      select: { id: true, dayOfWeek: true, startTime: true, endTime: true },
    });
    return NextResponse.json({ membershipId, role: m.role, windows: rows });
  } catch (error) {
    const { message, status } = sanitizeApiError(
      error,
      'admin.member-availability.get',
      'Could not load availability.',
    );
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PUT(req: NextRequest, ctx: { params: Promise<Params> }) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user || (user.role !== 'ADMIN' && !user.isSuperAdmin)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }
    const { id: centerId, membershipId } = await ctx.params;
    if (!user.isSuperAdmin && !hasMembershipRole(user, centerId, 'ADMIN')) {
      return NextResponse.json({ error: 'You are not an admin at this center' }, { status: 403 });
    }

    const m = await loadMembership(centerId, membershipId);
    if (!m) return NextResponse.json({ error: 'Membership not found' }, { status: 404 });
    if (m.role !== 'COACH' && m.role !== 'SIDEARM_SPECIALIST') {
      return NextResponse.json(
        { error: 'Availability is only modeled for coaches and sidearm specialists' },
        { status: 400 },
      );
    }

    let body: unknown;
    try { body = await req.json(); } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const parsed = PutSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 });
    }

    const newWeekly = parsed.data.windows.map((w) => ({
      membershipId,
      dayOfWeek: w.dayOfWeek,
      startTime: w.startTime,
      endTime: w.endTime,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any));

    // Fetch existing date ranges to keep them in the availability check
    const existingDateRanges = await prisma.membershipDateAvailability.findMany({
      where: { membershipId, isActive: true },
    });

    // Replace all rows for this membership in a single transaction.
    await prisma.$transaction([
      prisma.membershipAvailability.deleteMany({ where: { membershipId } }),
      ...(parsed.data.windows.length > 0
        ? [
            prisma.membershipAvailability.createMany({
              data: parsed.data.windows.map((w) => ({
                membershipId,
                dayOfWeek: w.dayOfWeek,
                startTime: w.startTime,
                endTime: w.endTime,
              })),
            }),
          ]
        : []),
    ]);

    // Check for impacted bookings and auto-cancel
    await autoCancelImpactedBookings({
      membershipId,
      centerId,
      adminUserId: user.id,
      adminName: user.name || user.id,
      newWeekly,
      newDateRanges: existingDateRanges,
    });

    const rows = await prisma.membershipAvailability.findMany({
      where: { membershipId },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
      select: { id: true, dayOfWeek: true, startTime: true, endTime: true },
    });
    return NextResponse.json({ membershipId, role: m.role, windows: rows });
  } catch (error) {
    const { message, status } = sanitizeApiError(
      error,
      'admin.member-availability.put',
      'Could not save availability.',
    );
    return NextResponse.json({ error: message }, { status });
  }
}
