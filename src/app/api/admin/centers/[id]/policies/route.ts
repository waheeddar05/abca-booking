import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSuperAdmin } from '@/lib/adminAuth';
import { invalidatePolicy } from '@/lib/policy';
import { z } from 'zod';

/**
 * Per-center policy overrides.
 *
 * GET   /api/admin/centers/[id]/policies              List all overrides at this center.
 * PUT   /api/admin/centers/[id]/policies              Upsert one (body: { key, value }).
 * DELETE /api/admin/centers/[id]/policies?key=FOO     Remove an override (revert to global default).
 *
 * The resolver in `src/lib/policy.ts` reads center → global → code default.
 * Removing a CenterPolicy row reverts the center to whatever the global
 * `Policy` table says.
 */

const UpsertSchema = z.object({
  key: z.string().min(1).max(120),
  value: z.string().max(20000),
});

type Params = { id: string };

export async function GET(req: NextRequest, ctx: { params: Promise<Params> }) {
  const session = await requireSuperAdmin(req);
  if (!session) return NextResponse.json({ error: 'Super admin required' }, { status: 403 });

  const { id: centerId } = await ctx.params;
  const overrides = await prisma.centerPolicy.findMany({
    where: { centerId },
    orderBy: { key: 'asc' },
  });

  // Also surface the global default for each key, so admins can compare.
  const keys = overrides.map((o) => o.key);
  const globals = keys.length
    ? await prisma.policy.findMany({ where: { key: { in: keys } } })
    : [];
  const globalsByKey = new Map(globals.map((g) => [g.key, g.value]));

  return NextResponse.json(
    overrides.map((o) => ({
      ...o,
      globalValue: globalsByKey.get(o.key) ?? null,
    })),
  );
}

export async function PUT(req: NextRequest, ctx: { params: Promise<Params> }) {
  const session = await requireSuperAdmin(req);
  if (!session) return NextResponse.json({ error: 'Super admin required' }, { status: 403 });

  const { id: centerId } = await ctx.params;
  const center = await prisma.center.findUnique({ where: { id: centerId } });
  if (!center) return NextResponse.json({ error: 'Center not found' }, { status: 404 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = UpsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 });
  }

  const upserted = await prisma.centerPolicy.upsert({
    where: { centerId_key: { centerId, key: parsed.data.key } },
    create: { centerId, key: parsed.data.key, value: parsed.data.value },
    update: { value: parsed.data.value },
  });

  invalidatePolicy(parsed.data.key, centerId);

  return NextResponse.json(upserted);
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<Params> }) {
  const session = await requireSuperAdmin(req);
  if (!session) return NextResponse.json({ error: 'Super admin required' }, { status: 403 });

  const { id: centerId } = await ctx.params;
  const { searchParams } = new URL(req.url);
  const key = searchParams.get('key');
  if (!key) return NextResponse.json({ error: 'key query param required' }, { status: 400 });

  await prisma.centerPolicy.deleteMany({ where: { centerId, key } });
  invalidatePolicy(key, centerId);

  return NextResponse.json({ key, deleted: true });
}
