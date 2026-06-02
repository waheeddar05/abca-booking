import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { resolveOwnSidearmMembership } from '@/lib/sidearm';
import { sanitizeApiError } from '@/lib/api-errors';
import { autoCancelImpactedBookings, getImpactedBookings } from '@/lib/availability-sync';

/**
 * Date-range availability for the *current user's own* sidearm
 * specialist membership.
 *
 *   GET  /api/sidearm/date-availability
 *   PUT  /api/sidearm/date-availability[?preview=true]
 *
 * User-facing sibling of
 * `/api/admin/centers/[id]/members/[membershipId]/date-availability` —
 * same validation and replace-all semantics, but scoped to the caller's
 * own membership (resolved server-side) instead of an admin-supplied id.
 * Writes land in the same MembershipDateAvailability table the admin tab
 * reads, so changes are reflected in both surfaces immediately.
 */

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

export async function GET(req: NextRequest) {
  try {
    const resolved = await resolveOwnSidearmMembership(req);
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    }
    const { membership } = resolved;

    const rows = await prisma.membershipDateAvailability.findMany({
      where: { membershipId: membership.id, isActive: true },
      orderBy: [{ fromDate: 'asc' }],
      select: { id: true, fromDate: true, toDate: true, startTime: true, endTime: true, label: true },
    });
    return NextResponse.json({ membershipId: membership.id, role: membership.role, windows: rows });
  } catch (error) {
    const { message, status } = sanitizeApiError(
      error,
      'sidearm.date-availability.get',
      'Could not load date availability.',
    );
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const resolved = await resolveOwnSidearmMembership(req);
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    }
    const { user, centerId, membership } = resolved;
    const membershipId = membership.id;

    let body: unknown;
    try { body = await req.json(); } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const parsed = PutSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 });
    }

    const preview = req.nextUrl.searchParams.get('preview') === 'true';

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

    if (preview) {
      const impacted = await getImpactedBookings({
        membershipId,
        centerId,
        newWeekly: existingWeekly,
        newDateRanges,
      });
      return NextResponse.json({ impactedCount: impacted.length, impactedBookings: impacted });
    }

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
    return NextResponse.json({ membershipId, role: membership.role, windows: rows });
  } catch (error) {
    const { message, status } = sanitizeApiError(
      error,
      'sidearm.date-availability.put',
      'Could not save date availability.',
    );
    return NextResponse.json({ error: message }, { status });
  }
}
