import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireCenterAdminForCenter } from '@/lib/adminAuth';
import { z } from 'zod';

const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'waheeddar8@gmail.com';

// What the center admin can change on a membership row:
//  - isActive / metadata stay as-is (membership-level toggles).
//  - `user` lets the admin fix typos in the staff member's basic
//    profile — name, email, mobile — without having to leave the
//    Members tab. Empty string clears the field; null also clears.
//    Email and mobile are uniqueness-checked at the DB layer.
const PatchSchema = z.object({
  isActive: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
  // Tie-breaker when multiple memberships are equally eligible at a
  // slot. Lower wins. Used by the Sidearm admin tab to re-rank
  // specialists; also accessible from the Members tab. Validated as
  // a non-negative integer to keep the ordering stable.
  priority: z.number().int().min(0).max(10_000).optional(),
  user: z.object({
    name:         z.string().max(120).optional().nullable().or(z.literal('')),
    email:        z.string().email().max(200).optional().nullable().or(z.literal('')),
    mobileNumber: z.string().max(20).optional().nullable().or(z.literal('')),
  }).optional(),
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

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 });
  }

  // Membership-level changes (isActive / metadata) on an ADMIN row stay
  // super-admin-only — a center admin shouldn't be able to demote or
  // reactivate a peer admin. Profile edits (the `user:` block) are fine
  // either way, since name / email / phone aren't authorization data.
  // The "edit name" affordance on the Members tab failed before this
  // because the old guard rejected ANY PATCH on an ADMIN membership.
  const isMembershipLevelChange =
    parsed.data.isActive !== undefined || parsed.data.metadata !== undefined;
  if (!ctxAuth.isSuperAdmin && m.role === 'ADMIN' && isMembershipLevelChange) {
    return NextResponse.json(
      { error: 'Only super admin can modify ADMIN memberships.' },
      { status: 403 },
    );
  }

  // Pull the underlying user once if a user-patch was supplied. The
  // super admin email is the project owner — refuse to let any path
  // (even super admin themselves) mutate it through this membership
  // surface to avoid surprises.
  const userPatch = parsed.data.user;
  if (userPatch) {
    const existingUser = await prisma.user.findUnique({
      where: { id: m.userId },
      select: { email: true },
    });
    if (existingUser?.email === SUPER_ADMIN_EMAIL) {
      return NextResponse.json(
        { error: 'Cannot edit super admin profile from a center membership.' },
        { status: 400 },
      );
    }
  }

  // Membership update + (optional) underlying user update run in one
  // transaction so a half-update can't leak through on failure.
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Membership-level fields. Only set when actually present in the
      // patch so we don't blank-out metadata by accident.
      const membershipData: Prisma.CenterMembershipUpdateInput = {};
      if (parsed.data.isActive !== undefined) membershipData.isActive = parsed.data.isActive;
      if (parsed.data.metadata !== undefined) {
        membershipData.metadata = (parsed.data.metadata as never) ?? Prisma.JsonNull;
      }
      if (parsed.data.priority !== undefined) {
        // Used by Sidearm + Coach pick-priority logic. Lower number =
        // first pick. Out-of-range values are rejected by the schema
        // (0..10_000) so we trust the value here.
        membershipData.priority = parsed.data.priority;
      }
      if (Object.keys(membershipData).length > 0) {
        await tx.centerMembership.update({
          where: { id: membershipId },
          data: membershipData,
        });
      }

      if (userPatch) {
        const userData: Prisma.UserUpdateInput = {};
        if (userPatch.name !== undefined) {
          userData.name = userPatch.name === '' ? null : (userPatch.name ?? null);
        }
        if (userPatch.email !== undefined) {
          userData.email = userPatch.email === '' ? null : (userPatch.email ?? null);
        }
        if (userPatch.mobileNumber !== undefined) {
          userData.mobileNumber = userPatch.mobileNumber === '' ? null : (userPatch.mobileNumber ?? null);
        }
        if (Object.keys(userData).length > 0) {
          await tx.user.update({ where: { id: m.userId }, data: userData });
        }
      }

      return tx.centerMembership.findUnique({
        where: { id: membershipId },
        include: { user: { select: { id: true, name: true, email: true, mobileNumber: true, role: true } } },
      });
    });

    return NextResponse.json(result);
  } catch (error: unknown) {
    // Catch the obvious uniqueness collisions on email / mobile so the
    // UI gets a readable message instead of a raw Prisma P2002 stack.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const target = (error.meta?.target as string[] | undefined)?.join(', ') ?? 'field';
      return NextResponse.json(
        { error: `That ${target} is already in use by another user.` },
        { status: 409 },
      );
    }
    throw error;
  }
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
