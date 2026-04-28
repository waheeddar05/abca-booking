import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';

/**
 * GET /api/centers/[id]/machines
 *
 * Public-ish read endpoint for the user-facing slot picker — any logged-
 * in user can list active machines at a center. Returns the same machine
 * shape as the admin endpoint but is not super-admin gated, because
 * regular users at Toplay legitimately need to see the machine list to
 * pick a Yantra/Leverage/etc. for booking.
 *
 * Admin-only fields (raw metadata, internal flags) are intentionally NOT
 * surfaced — only what the picker needs.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: centerId } = await ctx.params;
  const center = await prisma.center.findUnique({
    where: { id: centerId },
    select: { id: true, isActive: true },
  });
  if (!center || !center.isActive) {
    return NextResponse.json({ error: 'Center not found' }, { status: 404 });
  }

  const machines = await prisma.machine.findMany({
    where: { centerId, isActive: true },
    orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      name: true,
      shortName: true,
      isActive: true,
      displayOrder: true,
      supportedPitchTypes: true,
      supportedBallTypes: true,
      machineType: { select: { id: true, code: true, name: true, ballType: true, imageUrl: true } },
      resource: { select: { id: true, name: true, type: true } },
    },
  });
  return NextResponse.json(machines);
}
