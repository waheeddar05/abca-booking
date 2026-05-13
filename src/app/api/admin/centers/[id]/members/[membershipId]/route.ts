import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireCenterAdminForCenter } from '@/lib/adminAuth';
import { z } from 'zod';

const PatchSchema = z.object({
  isActive: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
});

type Params = { id: string; membershipId: string };

export async function PATCH(req: NextRequest, ctx: { params: Promise<Params> }) {
  const { id: centerId, membershipId } = await ctx.params;
  const ctxAuth = await requireCenterAdminForCenter(req, centerId);
  if (!ctxAuth) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

  const m = await prisma.centerMembership.findUnique({ where: { id: membershipId } });
  if (!m || m.centerId !== centerId) {
    return NextResponse.json({ error: 'Membership not found' }, { status: 404 });
  }

  // Center admins cannot reactivate or modify another ADMIN's membership.
  if (!ctxAuth.isSuperAdmin && m.role === 'ADMIN') {
    return NextResponse.json(
      { error: 'Only super admin can modify ADMIN memberships.' },
      { status: 403 },
    );
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 });
  }

  const updated = await prisma.centerMembership.update({
    where: { id: membershipId },
    data: parsed.data as never,
    include: { user: { select: { id: true, name: true, email: true, mobileNumber: true, role: true } } },
  });
  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<Params> }) {
  const { id: centerId, membershipId } = await ctx.params;
  const ctxAuth = await requireCenterAdminForCenter(req, centerId);
  if (!ctxAuth) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

  const m = await prisma.centerMembership.findUnique({ where: { id: membershipId } });
  if (!m || m.centerId !== centerId) {
    return NextResponse.json({ error: 'Membership not found' }, { status: 404 });
  }

  // Center admins cannot revoke another ADMIN — only super admin can.
  if (!ctxAuth.isSuperAdmin && m.role === 'ADMIN') {
    return NextResponse.json(
      { error: 'Only super admin can revoke ADMIN memberships.' },
      { status: 403 },
    );
  }

  // Soft-deactivate. Hard delete would lose audit trail of who-was-where.
  const updated = await prisma.centerMembership.update({
    where: { id: membershipId },
    data: { isActive: false },
  });
  return NextResponse.json({ id: updated.id, isActive: updated.isActive });
}
