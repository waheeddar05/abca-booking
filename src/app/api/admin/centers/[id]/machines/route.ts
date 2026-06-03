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

/**
 * Legacy "virtual" machine-type slugs that an older or cached admin bundle
 * may still POST (the dropdown used to hard-code these), mapped to the real
 * catalog `code` they correspond to. The current UI submits a real
 * MachineType.id instead, but we keep accepting these so a stale PWA cache
 * can't break the add-machine flow.
 */
const LEGACY_TYPE_SLUG_TO_CODE: Record<string, string> = {
  yantra: 'YANTRA',
  gravity: 'GRAVITY',
  leverage: 'LEVERAGE',
  'leverage-tennis': 'LEVERAGE',
  'master-200': 'LEVERAGE',
};

/**
 * Resolve a machine-type reference to a real MachineType row. Accepts both a
 * real `MachineType.id` (current UI) and a legacy virtual slug (cached UI),
 * the latter resolved via its catalog `code`. Returns null if neither hits.
 */
async function resolveMachineType(rawId: string) {
  const byId = await prisma.machineType.findUnique({ where: { id: rawId } });
  if (byId) return byId;
  const slug = rawId.trim().toLowerCase();
  const code = LEGACY_TYPE_SLUG_TO_CODE[slug] ?? slug.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  return prisma.machineType.findFirst({ where: { code } });
}


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

  // Resolve the machine type, tolerating both a real MachineType.id (current
  // UI) and the legacy virtual slugs a cached bundle may still send.
  let finalMachineTypeId: string | null = null;

  if (parsed.data.customMachineType) {
    // "Other" — find or create a MachineType by the typed name.
    const name = parsed.data.customMachineType.trim();
    let mt = await prisma.machineType.findFirst({ where: { name } });
    if (!mt) {
      const code = name.toLowerCase().replace(/\s+/g, '-').slice(0, 30);
      mt = await prisma.machineType.create({
        data: {
          name,
          code: `${code}-${Date.now().toString(36)}`,
          ballType: 'MACHINE', // Default for custom machines
          isActive: true,
        },
      });
    }
    finalMachineTypeId = mt.id;
  } else if (parsed.data.machineTypeId) {
    const mt = await resolveMachineType(parsed.data.machineTypeId);
    if (!mt) {
      return NextResponse.json({ error: 'Machine type not found' }, { status: 404 });
    }
    finalMachineTypeId = mt.id;
  }

  if (!finalMachineTypeId) {
    return NextResponse.json({ error: 'Machine type ID or custom name required' }, { status: 400 });
  }

  const [center, resource] = await Promise.all([
    prisma.center.findUnique({ where: { id: centerId } }),
    parsed.data.resourceId
      ? prisma.resource.findUnique({ where: { id: parsed.data.resourceId } })
      : Promise.resolve(null),
  ]);
  if (!center) return NextResponse.json({ error: 'Center not found' }, { status: 404 });
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
