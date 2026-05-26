import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser, hasMembershipRole } from '@/lib/auth';
import { sanitizeApiError } from '@/lib/api-errors';
import { autoCancelImpactedBookings } from '@/lib/availability-sync';

/**
 * Date-range availability for a coach or sidearm specialist
 * membership. Sister endpoint to `availability/route.ts` (weekly
 * recurring) — same auth, same membership/role gate, same PUT-as-
 * replace semantics.
 *
 *   GET  /api/admin/centers/[id]/members/[membershipId]/date-availability
 *   PUT  /api/admin/centers/[id]/members/[membershipId]/date-availability
 *
 * Each window covers a date range (inclusive) plus an optional
 * intra-day HH:MM window. Empty `windows` array clears every entry.
 *
 * Resolution: see schema.prisma → MembershipDateAvailability and
 * `slotMatchesAvailability` in resource-booking.ts for how the engine
 * combines recurring and date-range entries.
 */

type Params = { id: string; membershipId: string };

const TIME_HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;

const WindowSchema = z.object({
  fromDate: z.string().regex(DATE_ISO, 'Use YYYY-MM-DD'),
  toDate:   z.string().regex(DATE_ISO, 'Use YYYY-MM-DD'),
  startTime: z.string().regex(TIME_HHMM, 'Use HH:MM (24h)').optional().nullable(),
  endTime:   z.string().regex(TIME_HHMM, 'Use HH:MM (24h)').optional().nullable(),
  label:     z.string().max(120).optional().nullable(),
}).refine((w) => w.toDate >= w.fromDate, {
  message: 'toDate must be on or after fromDate',
  path: ['toDate'],
}).refine(
  (w) => !(w.startTime && w.endTime) || w.endTime > w.startTime,
  { message: 'endTime must be after startTime when both are set', path: ['endTime'] },
);

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
        { error: 'Date-range availability is only modeled for coaches and sidearm specialists' },
        { status: 400 },
      );
    }

    const rows = await prisma.membershipDateAvailability.findMany({
      where: { membershipId, isActive: true },
      orderBy: [{ fromDate: 'asc' }],
      select: { id: true, fromDate: true, toDate: true, startTime: true, endTime: true, label: true },
    });
    return NextResponse.json({ membershipId, role: m.role, windows: rows });
  } catch (error) {
    const { message, status } = sanitizeApiError(
      error,
      'admin.member-date-availability.get',
      'Could not load date availability.',
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
        { error: 'Date-range availability is only modeled for coaches and sidearm specialists' },
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

    const newDateRanges = parsed.data.windows.map((w) => ({
      membershipId,
      fromDate: new Date(`${w.fromDate}T00:00:00.000Z`),
      toDate: new Date(`${w.toDate}T00:00:00.000Z`),
      startTime: w.startTime || null,
      endTime: w.endTime || null,
      label: w.label || null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any));

    // Fetch existing weekly availability to keep it in the check
    const existingWeekly = await prisma.membershipAvailability.findMany({
      where: { membershipId, isActive: true },
    });

    // Replace-all semantics — same approach as the recurring availability
    // sibling endpoint.
    await prisma.$transaction([
      prisma.membershipDateAvailability.deleteMany({ where: { membershipId } }),
      ...(parsed.data.windows.length > 0
        ? [
            prisma.membershipDateAvailability.createMany({
              data: parsed.data.windows.map((w) => ({
                membershipId,
                fromDate: new Date(`${w.fromDate}T00:00:00.000Z`),
                toDate: new Date(`${w.toDate}T00:00:00.000Z`),
                startTime: w.startTime || null,
                endTime: w.endTime || null,
                label: w.label || null,
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
      newWeekly: existingWeekly,
      newDateRanges,
    });

    const rows = await prisma.membershipDateAvailability.findMany({
      where: { membershipId },
      orderBy: [{ fromDate: 'asc' }],
      select: { id: true, fromDate: true, toDate: true, startTime: true, endTime: true, label: true },
    });
    return NextResponse.json({ membershipId, role: m.role, windows: rows });
  } catch (error) {
    const { message, status } = sanitizeApiError(
      error,
      'admin.member-date-availability.put',
      'Could not save date availability.',
    );
    return NextResponse.json({ error: message }, { status });
  }
}
