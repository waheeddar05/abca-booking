import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSuperAdmin } from '@/lib/adminAuth';
import { z } from 'zod';

const MachineTypePatchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  ballType: z.enum(['LEATHER', 'TENNIS', 'MACHINE']).optional(),
  description: z.string().max(500).optional().nullable(),
  isActive: z.boolean().optional(),
});

type Params = { id: string };

export async function PATCH(req: NextRequest, ctx: { params: Promise<Params> }) {
  const session = await requireSuperAdmin(req);
  if (!session) return NextResponse.json({ error: 'Super admin required' }, { status: 403 });

  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = MachineTypePatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 });
  }

  const updated = await prisma.machineType.update({
    where: { id },
    data: parsed.data,
  });
  return NextResponse.json(updated);
}
