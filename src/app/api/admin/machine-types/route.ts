import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSuperAdmin } from '@/lib/adminAuth';
import { getAuthenticatedUser } from '@/lib/auth';
import { z } from 'zod';

/**
 * Machine type catalog — global. Read is open to any admin so they can
 * pick a type when adding a Machine to their center. Writes
 * (POST / PATCH / DELETE) remain super-admin-only since editing the
 * catalog affects every center.
 *
 * GET  /api/admin/machine-types     List all (admin OR super admin)
 * POST /api/admin/machine-types     Add a new type (super admin only)
 *
 * Each Center then creates Machine instances pointing at one of these.
 */

const MachineTypeCreateSchema = z.object({
  code: z.string().min(2).max(40).regex(/^[A-Z][A-Z0-9_]*$/, 'Use uppercase letters/digits/underscore'),
  name: z.string().min(1).max(120),
  ballType: z.enum(['LEATHER', 'TENNIS', 'MACHINE']),
  description: z.string().max(500).optional().nullable(),
  imageUrl: z.string().max(500).optional().nullable(),
  isActive: z.boolean().default(true),
});

export async function GET(req: NextRequest) {
  // Open to any global ADMIN (center admins included) — they need to
  // pick a machine type when adding a Machine. Authenticated users
  // without ADMIN role still get a 403.
  const user = await getAuthenticatedUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'ADMIN' && !user.isSuperAdmin) {
    return NextResponse.json({ error: 'Admin required' }, { status: 403 });
  }

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
