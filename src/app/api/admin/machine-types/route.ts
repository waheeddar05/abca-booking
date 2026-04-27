import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSuperAdmin } from '@/lib/adminAuth';
import { z } from 'zod';

/**
 * Machine type catalog — global, super admin only.
 *
 * GET  /api/admin/machine-types     List all
 * POST /api/admin/machine-types     Add a new type (e.g. "ProBatter")
 *
 * Each Center then creates Machine instances pointing at one of these.
 */

const MachineTypeCreateSchema = z.object({
  code: z.string().min(2).max(40).regex(/^[A-Z][A-Z0-9_]*$/, 'Use uppercase letters/digits/underscore'),
  name: z.string().min(1).max(120),
  ballType: z.enum(['LEATHER', 'TENNIS', 'MACHINE']),
  description: z.string().max(500).optional().nullable(),
  isActive: z.boolean().default(true),
});

export async function GET(req: NextRequest) {
  const session = await requireSuperAdmin(req);
  if (!session) return NextResponse.json({ error: 'Super admin required' }, { status: 403 });

  const types = await prisma.machineType.findMany({
    orderBy: { name: 'asc' },
    include: {
      _count: { select: { machines: true } },
    },
  });
  return NextResponse.json(types);
}

export async function POST(req: NextRequest) {
  const session = await requireSuperAdmin(req);
  if (!session) return NextResponse.json({ error: 'Super admin required' }, { status: 403 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = MachineTypeCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 });
  }

  const existing = await prisma.machineType.findUnique({ where: { code: parsed.data.code } });
  if (existing) {
    return NextResponse.json({ error: `Code "${parsed.data.code}" already exists` }, { status: 409 });
  }

  const created = await prisma.machineType.create({ data: parsed.data });
  return NextResponse.json(created, { status: 201 });
}
