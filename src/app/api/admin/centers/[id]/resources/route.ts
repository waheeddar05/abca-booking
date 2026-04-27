import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSuperAdmin } from '@/lib/adminAuth';
import { z } from 'zod';

/**
 * Resources (nets, courts, turf wickets) under a center.
 *
 * The resource-based booking model (Toplay) consumes these as the "supply
 * side": each booking takes 1+ resources. ABCA centers can leave this
 * empty.
 */

const ResourceCreateSchema = z.object({
  name: z.string().min(1).max(120),
  type: z.enum(['NET', 'TURF_WICKET', 'CEMENT_WICKET', 'COURT']),
  category: z.enum(['INDOOR', 'OUTDOOR']),
  capacity: z.number().int().positive().default(1),
  isActive: z.boolean().default(true),
  displayOrder: z.number().int().optional(),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
});

type Params = { id: string };

export async function GET(req: NextRequest, ctx: { params: Promise<Params> }) {
  const session = await requireSuperAdmin(req);
  if (!session) return NextResponse.json({ error: 'Super admin required' }, { status: 403 });

  const { id: centerId } = await ctx.params;
  const resources = await prisma.resource.findMany({
    where: { centerId },
    orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { machines: true } } },
  });
  return NextResponse.json(resources);
}

export async function POST(req: NextRequest, ctx: { params: Promise<Params> }) {
  const session = await requireSuperAdmin(req);
  if (!session) return NextResponse.json({ error: 'Super admin required' }, { status: 403 });

  const { id: centerId } = await ctx.params;
  const center = await prisma.center.findUnique({ where: { id: centerId } });
  if (!center) return NextResponse.json({ error: 'Center not found' }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = ResourceCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 });
  }

  const created = await prisma.resource.create({
    data: {
      centerId,
      name: parsed.data.name,
      type: parsed.data.type,
      category: parsed.data.category,
      capacity: parsed.data.capacity,
      isActive: parsed.data.isActive,
      displayOrder: parsed.data.displayOrder ?? 0,
      metadata: (parsed.data.metadata as never) ?? undefined,
    },
  });
  return NextResponse.json(created, { status: 201 });
}
