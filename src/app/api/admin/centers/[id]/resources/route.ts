import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireCenterAdminForCenter } from '@/lib/adminAuth';
import { getAuthenticatedUser, hasMembershipRole } from '@/lib/auth';
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
  const { id: centerId } = await ctx.params;
  // Read access: super admins, center admins, AND moderators. The Slots
  // block editor (ResourceBlockManagement) needs the resource list on
  // resource-based centers, and moderators have full Slots access. Resource
  // mutations (POST/PATCH/DELETE) stay admin-only via requireCenterAdminForCenter.
  const user = await getAuthenticatedUser(req);
  const canRead =
    !!user &&
    (user.isSuperAdmin ||
      hasMembershipRole(user, centerId, 'ADMIN') ||
      hasMembershipRole(user, centerId, 'MODERATOR'));
  if (!canRead) return NextResponse.json({ error: 'Admin required' }, { status: 403 });
  const resources = await prisma.resource.findMany({
    where: { centerId },
    orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { machines: true } } },
  });
  return NextResponse.json(resources);
}

export async function POST(req: NextRequest, ctx: { params: Promise<Params> }) {
  const { id: centerId } = await ctx.params;
  const ctxAuth = await requireCenterAdminForCenter(req, centerId);
  if (!ctxAuth) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

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
