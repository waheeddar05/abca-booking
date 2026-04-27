import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSuperAdmin } from '@/lib/adminAuth';
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
  const session = await requireSuperAdmin(req);
  if (!session) return NextResponse.json({ error: 'Super admin required' }, { status: 403 });

  const { id: centerId, resourceId } = await ctx.params;

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

export async function DELETE(req: NextRequest, ctx: { params: Promise<Params> }) {
  const session = await requireSuperAdmin(req);
  if (!session) return NextResponse.json({ error: 'Super admin required' }, { status: 403 });

  const { id: centerId, resourceId } = await ctx.params;
  const resource = await prisma.resource.findUnique({ where: { id: resourceId } });
  if (!resource || resource.centerId !== centerId) {
    return NextResponse.json({ error: 'Resource not found at this center' }, { status: 404 });
  }

  // Soft-delete only.
  const updated = await prisma.resource.update({
    where: { id: resourceId },
    data: { isActive: false },
  });
  return NextResponse.json({ id: updated.id, isActive: updated.isActive });
}
