import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSuperAdmin } from '@/lib/adminAuth';
import { z } from 'zod';

const MachinePatchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  shortName: z.string().max(60).optional().nullable(),
  resourceId: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
  displayOrder: z.number().int().optional(),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
});

type Params = { id: string; machineId: string };

export async function PATCH(req: NextRequest, ctx: { params: Promise<Params> }) {
  const session = await requireSuperAdmin(req);
  if (!session) return NextResponse.json({ error: 'Super admin required' }, { status: 403 });

  const { id: centerId, machineId } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = MachinePatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 });
  }

  // Confirm machine belongs to this center, and resource (if changing) belongs too.
  const machine = await prisma.machine.findUnique({ where: { id: machineId } });
  if (!machine || machine.centerId !== centerId) {
    return NextResponse.json({ error: 'Machine not found at this center' }, { status: 404 });
  }
  if (parsed.data.resourceId) {
    const resource = await prisma.resource.findUnique({ where: { id: parsed.data.resourceId } });
    if (!resource || resource.centerId !== centerId) {
      return NextResponse.json({ error: 'Resource does not belong to this center' }, { status: 400 });
    }
  }

  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed.data)) {
    data[k] = v === '' ? null : v;
  }

  const updated = await prisma.machine.update({
    where: { id: machineId },
    data,
    include: {
      machineType: { select: { id: true, code: true, name: true, ballType: true, imageUrl: true } },
      resource: { select: { id: true, name: true, type: true } },
    },
  });
  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<Params> }) {
  const session = await requireSuperAdmin(req);
  if (!session) return NextResponse.json({ error: 'Super admin required' }, { status: 403 });

  const { id: centerId, machineId } = await ctx.params;
  const machine = await prisma.machine.findUnique({ where: { id: machineId } });
  if (!machine || machine.centerId !== centerId) {
    return NextResponse.json({ error: 'Machine not found at this center' }, { status: 404 });
  }

  // Soft-delete only — Booking rows reference machines via the legacy enum
  // (or, in resource-based mode, via metadata) and we don't want to break
  // history.
  const updated = await prisma.machine.update({
    where: { id: machineId },
    data: { isActive: false },
  });
  return NextResponse.json({ id: updated.id, isActive: updated.isActive });
}
