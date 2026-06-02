import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { resolveOwnSidearmMembership } from '@/lib/sidearm';
import { sanitizeApiError } from '@/lib/api-errors';
import { autoCancelImpactedBookings, getImpactedBookings } from '@/lib/availability-sync';

/**
 * Weekly recurring availability for the *current user's own* sidearm
 * specialist membership.
 *
 *   GET  /api/sidearm/availability
 *   PUT  /api/sidearm/availability[?preview=true]
 *
 * User-facing sibling of
 * `/api/admin/centers/[id]/members/[membershipId]/availability` — same
 * validation, same PUT-as-replace semantics, same impacted-booking
 * preview/auto-cancel flow. The difference is auth: instead of requiring
 * an admin and trusting a membershipId from the URL, this resolves the
 * caller's own SIDEARM_SPECIALIST membership at the current center, so a
 * specialist can only ever edit their own schedule. Writes land in the
 * same MembershipAvailability table the admin tab reads.
 */

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

export async function GET(req: NextRequest) {
  try {
    const resolved = await resolveOwnSidearmMembership(req);
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    }
    const { membership } = resolved;

    const rows = await prisma.membershipAvailability.findMany({
      where: { membershipId: membership.id, isActive: true },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
      select: { id: true, dayOfWeek: true, startTime: true, endTime: true },
    });
    return NextResponse.json({ membershipId: membership.id, role: membership.role, windows: rows });
  } catch (error) {
    const { message, status } = sanitizeApiError(
      error,
      'sidearm.availability.get',
      'Could not load availability.',
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

    if (preview) {
      const impacted = await getImpactedBookings({
        membershipId,
        centerId,
        newWeekly,
        newDateRanges: existingDateRanges,
      });
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
    return NextResponse.json({ membershipId, role: membership.role, windows: rows });
  } catch (error) {
    const { message, status } = sanitizeApiError(
      error,
      'sidearm.availability.put',
      'Could not save availability.',
    );
    return NextResponse.json({ error: message }, { status });
  }
}
