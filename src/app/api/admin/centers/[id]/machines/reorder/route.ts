import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireCenterAdminForCenter } from '@/lib/adminAuth';
import { z } from 'zod';

/**
 * PUT /api/admin/centers/[id]/machines/reorder
 *
 * Bulk-set the display order for a center's machines. The body is the
 * full ordered list of machine ids; each machine's `displayOrder` is set
 * to its index in that list, inside one transaction so the ordering is
 * applied atomically (no half-applied states, and no reliance on the
 * pre-existing — often all-zero — displayOrder values).
 *
 * The same `displayOrder` drives the user-facing machine order (the
 * "Book Your Slot" selector reads /api/centers/[id]/machines, which sorts
 * by displayOrder), so reordering here is reflected for users too.
 */
const ReorderSchema = z.object({
  machineIds: z.array(z.string().min(1)).min(1),
});

type Params = { id: string };

export async function PUT(req: NextRequest, ctx: { params: Promise<Params> }) {
  const { id: centerId } = await ctx.params;
  const ctxAuth = await requireCenterAdminForCenter(req, centerId);
  if (!ctxAuth) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = ReorderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 });
  }

  const { machineIds } = parsed.data;
  // Reject duplicate ids — a malformed payload could otherwise silently
  // collapse the ordering.
  if (new Set(machineIds).size !== machineIds.length) {
    return NextResponse.json({ error: 'Duplicate machine ids' }, { status: 400 });
  }

  // Every id must be a machine at THIS center; prevents reordering (or
  // probing) machines from another center via a tampered payload.
  const machines = await prisma.machine.findMany({
    where: { id: { in: machineIds }, centerId },
    select: { id: true },
  });
  if (machines.length !== machineIds.length) {
    return NextResponse.json({ error: 'One or more machines do not belong to this center' }, { status: 400 });
  }

  await prisma.$transaction(
    machineIds.map((id, index) =>
      prisma.machine.update({ where: { id }, data: { displayOrder: index } }),
    ),
  );

  const updated = await prisma.machine.findMany({
    where: { centerId },
    orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    include: {
      machineType: { select: { id: true, code: true, name: true, ballType: true, imageUrl: true } },
      resource: { select: { id: true, name: true, type: true } },
    },
  });
  return NextResponse.json(updated);
}
