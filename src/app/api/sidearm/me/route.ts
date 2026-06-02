import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resolveOwnSidearmMembership } from '@/lib/sidearm';
import { sanitizeApiError } from '@/lib/api-errors';

/**
 * GET /api/sidearm/me
 *
 * Returns the authenticated user's own SIDEARM_SPECIALIST membership at
 * the current center, shaped exactly like the admin Sidearm list rows
 * (so the user-facing `/sidearm` page can reuse the shared card). The
 * weekly + date-range availability come from the same tables the admin
 * Sidearm tab reads, so the two views stay in sync.
 *
 * Returns 403 when the user is not a sidearm specialist at this center —
 * the user page uses that to render a "not a specialist" notice instead
 * of the editor.
 */
export async function GET(req: NextRequest) {
  try {
    const resolved = await resolveOwnSidearmMembership(req);
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    }

    const membership = await prisma.centerMembership.findUnique({
      where: { id: resolved.membership.id },
      select: {
        id: true,
        priority: true,
        user: { select: { id: true, name: true, email: true, mobileNumber: true } },
        availability: {
          where: { isActive: true },
          select: { id: true, dayOfWeek: true, startTime: true, endTime: true },
          orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
        },
        dateAvailability: {
          where: { isActive: true },
          select: { id: true, fromDate: true, toDate: true, startTime: true, endTime: true, label: true },
          orderBy: [{ fromDate: 'asc' }],
        },
      },
    });

    return NextResponse.json({ specialist: membership, centerId: resolved.centerId });
  } catch (error) {
    const { message, status } = sanitizeApiError(
      error,
      'sidearm.me.get',
      'Could not load your availability.',
    );
    return NextResponse.json({ error: message }, { status });
  }
}
