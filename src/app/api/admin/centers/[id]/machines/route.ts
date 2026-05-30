import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireCenterAdminForCenter } from '@/lib/adminAuth';
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

// Three surfaces only — see lib/pitch-config.ts. 'TURF' is intentionally
// dropped from the Zod allow-list so admins can't save it via the form;
// the enum value remains in the DB schema for back-compat with old rows.
const PitchTypeEnum = z.enum(['ASTRO', 'CEMENT', 'NATURAL']);
const BallTypeEnum = z.enum(['TENNIS', 'LEATHER', 'MACHINE']);

const MachineCreateSchema = z.object({
  machineTypeId: z.string().optional().nullable(),
  customMachineType: z.string().optional().nullable(),
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
  const { id: centerId } = await ctx.params;
  const ctxAuth = await requireCenterAdminForCenter(req, centerId);
  if (!ctxAuth) return NextResponse.json({ error: 'Admin required' }, { status: 403 });
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
  const { id: centerId } = await ctx.params;
  const ctxAuth = await requireCenterAdminForCenter(req, centerId);
  if (!ctxAuth) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

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
  let finalMachineTypeId = parsed.data.machineTypeId;

  if (parsed.data.customMachineType) {
    // Check if a machine type with this name already exists
    let mt = await prisma.machineType.findFirst({
      where: { name: parsed.data.customMachineType.trim() },
    });
    if (!mt) {
      // Create a new MachineType for this custom entry
      const code = parsed.data.customMachineType.toLowerCase().replace(/\s+/g, '-').slice(0, 30);
      mt = await prisma.machineType.create({
        data: {
          name: parsed.data.customMachineType.trim(),
          code: `${code}-${Date.now().toString(36)}`,
          ballType: 'MACHINE', // Default for custom machines
          isActive: true,
        },
      });
    }
    finalMachineTypeId = mt.id;
  } else if (parsed.data.machineTypeId?.startsWith('yantra-') || parsed.data.machineTypeId?.startsWith('master-200-')) {
    // Handle the UI-only virtual IDs for defaults
    const name = parsed.data.machineTypeId.includes('yantra') ? 'Yantra (Leather Gravity)' : 'Master 200 (Tennis Leverage)';
    const ballType = parsed.data.machineTypeId.includes('leather') ? 'LEATHER' : 'TENNIS';
    let mt = await prisma.machineType.findFirst({ where: { name } });
    if (!mt) {
      mt = await prisma.machineType.create({
        data: {
          name,
          code: parsed.data.machineTypeId,
          ballType,
          isActive: true,
        },
      });
    }
    finalMachineTypeId = mt.id;
  }

  if (!finalMachineTypeId) {
    return NextResponse.json({ error: 'Machine type ID or custom name required' }, { status: 400 });
  }

  const [center, mt, resource] = await Promise.all([
    prisma.center.findUnique({ where: { id: centerId } }),
    prisma.machineType.findUnique({ where: { id: finalMachineTypeId } }),
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
      machineTypeId: finalMachineTypeId,
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
