import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSuperAdmin } from '@/lib/adminAuth';
import { z } from 'zod';

/**
 * Machines under a specific center.
 *
 * GET  /api/admin/centers/[id]/machines     List
 * POST /api/admin/centers/[id]/machines     Create
 *
 * Machines are not tied to a single Resource (net) at the schema level —
 * `resourceId` is just a "default home." At booking time the resource-
 * based engine assigns a machine to a free net dynamically.
 */

const PitchTypeEnum = z.enum(['ASTRO', 'TURF', 'CEMENT', 'NATURAL']);
const BallTypeEnum = z.enum(['TENNIS', 'LEATHER', 'MACHINE']);

const MachineCreateSchema = z.object({
  machineTypeId: z.string().min(1, 'machineTypeId is required'),
  name: z.string().min(1).max(120),
  shortName: z.string().max(60).optional().nullable(),
  resourceId: z.string().optional().nullable(),
  isActive: z.boolean().default(true),
  displayOrder: z.number().int().optional(),
  /** Pitch compatibility chips shown to the user. Empty = no chip row. */
  supportedPitchTypes: z.array(PitchTypeEnum).default([]),
  /** Ball compatibility chips. Empty = falls back to MachineType.ballType. */
  supportedBallTypes: z.array(BallTypeEnum).default([]),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
});

type Params = { id: string };

export async function GET(req: NextRequest, ctx: { params: Promise<Params> }) {
  const session = await requireSuperAdmin(req);
  if (!session) return NextResponse.json({ error: 'Super admin required' }, { status: 403 });

  const { id: centerId } = await ctx.params;
  const machines = await prisma.machine.findMany({
    where: { centerId },
    orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    include: {
      machineType: { select: { id: true, code: true, name: true, ballType: true, imageUrl: true } },
      resource: { select: { id: true, name: true, type: true } },
    },
  });
  return NextResponse.json(machines);
}

export async function POST(req: NextRequest, ctx: { params: Promise<Params> }) {
  const session = await requireSuperAdmin(req);
  if (!session) return NextResponse.json({ error: 'Super admin required' }, { status: 403 });

  const { id: centerId } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = MachineCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 });
  }

  // Verify center & machineType exist; resource (if set) belongs to this center.
  const [center, mt, resource] = await Promise.all([
    prisma.center.findUnique({ where: { id: centerId } }),
    prisma.machineType.findUnique({ where: { id: parsed.data.machineTypeId } }),
    parsed.data.resourceId
      ? prisma.resource.findUnique({ where: { id: parsed.data.resourceId } })
      : Promise.resolve(null),
  ]);
  if (!center) return NextResponse.json({ error: 'Center not found' }, { status: 404 });
  if (!mt) return NextResponse.json({ error: 'Machine type not found' }, { status: 404 });
  if (parsed.data.resourceId && (!resource || resource.centerId !== centerId)) {
    return NextResponse.json({ error: 'Resource does not belong to this center' }, { status: 400 });
  }

  const created = await prisma.machine.create({
    data: {
      centerId,
      machineTypeId: parsed.data.machineTypeId,
      name: parsed.data.name,
      shortName: parsed.data.shortName || null,
      resourceId: parsed.data.resourceId || null,
      isActive: parsed.data.isActive,
      displayOrder: parsed.data.displayOrder ?? 0,
      supportedPitchTypes: parsed.data.supportedPitchTypes,
      supportedBallTypes: parsed.data.supportedBallTypes,
      metadata: (parsed.data.metadata as never) ?? undefined,
    },
    include: {
      machineType: { select: { id: true, code: true, name: true, ballType: true, imageUrl: true } },
      resource: { select: { id: true, name: true, type: true } },
    },
  });
  return NextResponse.json(created, { status: 201 });
}
