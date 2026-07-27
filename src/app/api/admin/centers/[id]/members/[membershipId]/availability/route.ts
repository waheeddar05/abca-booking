import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser, hasMembershipRole } from '@/lib/auth';
import { sanitizeApiError } from '@/lib/api-errors';
import { autoCancelImpactedBookings, getImpactedBookings } from '@/lib/availability-sync';

/**
 * Weekly recurring availability schedule for a coach, sidearm
 * specialist, ground-staff, or operator membership.
 *
 *   GET  /api/admin/centers/[id]/members/[membershipId]/availability
 *   PUT  /api/admin/centers/[id]/members/[membershipId]/availability
 *
 * GET returns the current rows (sorted by day-of-week then startTime).
 * PUT does a full replace — the body's `windows` array becomes the
 * canonical schedule, all previous rows are deleted, atomic in one
 * transaction. Empty array clears the schedule (which means "unavailable by
 * default" per the engine's default).
 *
 * Auth: must be a full admin at this center, or super admin. The
 * staff-management tabs this route serves are closed to moderators.
 * Availability for ADMIN memberships is not modeled.
 */

type Params = { id: string; membershipId: string };

/** Membership roles whose availability this route manages. */
const AVAILABILITY_ROLES = ['COACH', 'SIDEARM_SPECIALIST', 'GROUND_STAFF', 'OPERATOR'] as const;
type AvailabilityRole = (typeof AVAILABILITY_ROLES)[number];

/**
 * Gate a membership by role. Returns an error response when the role has
 * no availability model; null when the caller may proceed.
 */
function checkRole(role: string): NextResponse | null {
  if (!AVAILABILITY_ROLES.includes(role as AvailabilityRole)) {
    return NextResponse.json(
      { error: 'Availability is only modeled for coaches, sidearm specialists, ground staff, and operators' },
      { status: 400 },
    );
  }
  return null;
}

const TIME_HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;
const WindowSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().regex(TIME_HHMM, 'Use HH:MM (24h)'),
  endTime:   z.string().regex(TIME_HHMM, 'Use HH:MM (24h)'),
}).refine((w) => w.endTime > w.startTime, {
  message: 'endTime must be after startTime',
  path: ['endTime'],
});

// The weekly schedule applies only within this optional effective date
// range (inclusive, IST). Null/omitted on a side = no limit there. The
// range is schedule-level: it's applied to every saved window row.
const PutSchema = z.object({
  effectiveFrom: z.string().regex(DATE_ISO, 'Use YYYY-MM-DD').optional().nullable(),
  effectiveTo:   z.string().regex(DATE_ISO, 'Use YYYY-MM-DD').optional().nullable(),
  windows: z.array(WindowSchema).max(50),
}).refine(
  (d) => !(d.effectiveFrom && d.effectiveTo) || d.effectiveTo >= d.effectiveFrom,
  { message: 'End date must be on or after start date', path: ['effectiveTo'] },
);

/** Parse a YYYY-MM-DD string to a UTC-midnight Date (matches @db.Date). */
function parseDateOnly(s: string | null | undefined): Date | null {
  return s ? new Date(`${s}T00:00:00.000Z`) : null;
}

async function loadMembership(centerId: string, membershipId: string) {
  return prisma.centerMembership.findUnique({
    where: { id: membershipId },
    select: { id: true, centerId: true, role: true, isActive: true },
  }).then((m) => (m && m.centerId === centerId ? m : null));
}

/**
 * Full admin at this center, or super admin — see file header.
 * Moderators are not admitted.
 */
function canManageStaffAvailability(
  user: NonNullable<Awaited<ReturnType<typeof getAuthenticatedUser>>>,
  centerId: string,
): boolean {
  if (user.isSuperAdmin) return true;
  if (user.role !== 'ADMIN') return false;
  return hasMembershipRole(user, centerId, 'ADMIN');
}

export async function GET(req: NextRequest, ctx: { params: Promise<Params> }) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }
    const { id: centerId, membershipId } = await ctx.params;
    if (!canManageStaffAvailability(user, centerId)) {
      return NextResponse.json({ error: 'You are not an admin at this center' }, { status: 403 });
    }

    const m = await loadMembership(centerId, membershipId);
    if (!m) return NextResponse.json({ error: 'Membership not found' }, { status: 404 });
    const roleError = checkRole(m.role);
    if (roleError) return roleError;

    const rows = await prisma.membershipAvailability.findMany({
      where: { membershipId, isActive: true },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
      select: { id: true, dayOfWeek: true, startTime: true, endTime: true, effectiveFrom: true, effectiveTo: true },
    });
    // The effective range is schedule-level — surface it at the top level
    // (derived from the first row) for convenience as well as per-row.
    return NextResponse.json({
      membershipId,
      role: m.role,
      effectiveFrom: rows[0]?.effectiveFrom ?? null,
      effectiveTo: rows[0]?.effectiveTo ?? null,
      windows: rows,
    });
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
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }
    const { id: centerId, membershipId } = await ctx.params;
    if (!canManageStaffAvailability(user, centerId)) {
      return NextResponse.json({ error: 'You are not an admin at this center' }, { status: 403 });
    }

    const m = await loadMembership(centerId, membershipId);
    if (!m) return NextResponse.json({ error: 'Membership not found' }, { status: 404 });
    const roleError = checkRole(m.role);
    if (roleError) return roleError;

    let body: unknown;
    try { body = await req.json(); } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const parsed = PutSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 });
    }

    const preview = req.nextUrl.searchParams.get('preview') === 'true';

    const effectiveFrom = parseDateOnly(parsed.data.effectiveFrom);
    const effectiveTo = parseDateOnly(parsed.data.effectiveTo);

    const newWeekly = parsed.data.windows.map((w) => ({
      membershipId,
      dayOfWeek: w.dayOfWeek,
      startTime: w.startTime,
      endTime: w.endTime,
      effectiveFrom,
      effectiveTo,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any));

    if (preview) {
      const impacted = await getImpactedBookings({ membershipId, centerId, newWeekly });
      return NextResponse.json({ impactedCount: impacted.length, impactedBookings: impacted });
    }

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
                effectiveFrom,
                effectiveTo,
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
    });

    const rows = await prisma.membershipAvailability.findMany({
      where: { membershipId },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
      select: { id: true, dayOfWeek: true, startTime: true, endTime: true, effectiveFrom: true, effectiveTo: true },
    });
    return NextResponse.json({
      membershipId,
      role: m.role,
      effectiveFrom: rows[0]?.effectiveFrom ?? null,
      effectiveTo: rows[0]?.effectiveTo ?? null,
      windows: rows,
    });
  } catch (error) {
    const { message, status } = sanitizeApiError(
      error,
      'admin.member-availability.put',
      'Could not save availability.',
    );
    return NextResponse.json({ error: message }, { status });
  }
}
