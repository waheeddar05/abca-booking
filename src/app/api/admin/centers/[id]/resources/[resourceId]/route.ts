import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireCenterAdminForCenter } from '@/lib/adminAuth';
import { z } from 'zod';

const ResourcePatchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  type: z.enum(['NET', 'TURF_WICKET', 'CEMENT_WICKET', 'COURT']).optional(),
  category: z.enum(['INDOOR', 'OUTDOOR']).optional(),
  capacity: z.number().int().positive().optional(),
  isActive: z.boolean().optional(),
  displayOrder: z.number().int().optional(),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
});

type Params = { id: string; resourceId: string };

export async function PATCH(req: NextRequest, ctx: { params: Promise<Params> }) {
  const { id: centerId, resourceId } = await ctx.params;
  const ctxAuth = await requireCenterAdminForCenter(req, centerId);
  if (!ctxAuth) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

  const resource = await prisma.resource.findUnique({ where: { id: resourceId } });
  if (!resource || resource.centerId !== centerId) {
    return NextResponse.json({ error: 'Resource not found at this center' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = ResourcePatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 });
  }

  const updated = await prisma.resource.update({
    where: { id: resourceId },
    data: parsed.data as never,
  });
  return NextResponse.json(updated);
}

/**
 * DELETE /api/admin/centers/[id]/resources/[resourceId]
 *
 * Two modes:
 *   - default (no `hard` flag) → soft-delete, sets isActive=false.
 *     This is the safe default — bookings that already reference the
 *     resource keep working, the resource just stops appearing in the
 *     pickers.
 *   - ?hard=true → permanent row-level delete. Refuses (409) when any
 *     BookingResourceAssignment or Machine row still references the
 *     resource — those FKs would otherwise cascade-fail with a Postgres
 *     constraint error and leak a P2003 to the client. The admin's
 *     escape hatch is to either cancel/migrate the linked bookings /
 *     machines first, or stick with soft-delete.
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<Params> }) {
  const { id: centerId, resourceId } = await ctx.params;
  const ctxAuth = await requireCenterAdminForCenter(req, centerId);
  if (!ctxAuth) return NextResponse.json({ error: 'Admin required' }, { status: 403 });
  const resource = await prisma.resource.findUnique({ where: { id: resourceId } });
  if (!resource || resource.centerId !== centerId) {
    return NextResponse.json({ error: 'Resource not found at this center' }, { status: 404 });
  }

  const hard = new URL(req.url).searchParams.get('hard') === 'true';

  if (hard) {
    // Refuse when anything still points at this resource. We don't
    // cascade — losing audit-trail rows because someone fat-fingered
    // a Delete button is a bigger mistake than the orphan resource.
    const [bookingRefs, machineRefs] = await Promise.all([
      prisma.bookingResourceAssignment.count({ where: { resourceId } }),
      prisma.machine.count({ where: { resourceId } }),
    ]);
    if (bookingRefs > 0 || machineRefs > 0) {
      return NextResponse.json(
        {
          error:
            `Cannot permanently delete this resource — `
            + `${bookingRefs} booking(s) and ${machineRefs} machine(s) still reference it. `
            + `Cancel or reassign them first, or leave it deactivated.`,
          bookingRefs,
          machineRefs,
        },
        { status: 409 },
      );
    }

    await prisma.resource.delete({ where: { id: resourceId } });
    return NextResponse.json({ id: resourceId, deleted: true });
  }

  // Soft-delete (default).
  const updated = await prisma.resource.update({
    where: { id: resourceId },
    data: { isActive: false },
  });
  return NextResponse.json({ id: updated.id, isActive: updated.isActive });
}
