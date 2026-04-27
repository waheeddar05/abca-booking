import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSuperAdmin } from '@/lib/adminAuth';
import { z } from 'zod';

/**
 * Center memberships (admin / operator / coach / sidearm staff).
 *
 * GET  ?role=ADMIN&q=foo   List active memberships at this center,
 *                          optionally filtered by role / search query.
 * POST                     Assign a user. Body either targets an existing
 *                          user by `userId` OR `email` / `mobileNumber`,
 *                          OR creates one (super admin can mint a coach
 *                          who has never logged in).
 */

const MembershipCreateSchema = z.object({
  role: z.enum(['ADMIN', 'OPERATOR', 'COACH', 'SIDEARM_STAFF']),
  // One of these must be provided to identify or create the user:
  userId: z.string().optional(),
  email: z.string().email().optional(),
  mobileNumber: z.string().min(6).max(20).optional(),
  // Required only when creating a brand-new user:
  name: z.string().max(120).optional(),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
}).refine(
  (d) => d.userId || d.email || d.mobileNumber,
  { message: 'Provide userId, email, or mobileNumber' },
);

type Params = { id: string };

export async function GET(req: NextRequest, ctx: { params: Promise<Params> }) {
  const session = await requireSuperAdmin(req);
  if (!session) return NextResponse.json({ error: 'Super admin required' }, { status: 403 });

  const { id: centerId } = await ctx.params;
  const { searchParams } = new URL(req.url);
  const role = searchParams.get('role');
  const q = searchParams.get('q');

  const where: Record<string, unknown> = { centerId, isActive: true };
  if (role) where.role = role;
  if (q) {
    where.user = {
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { mobileNumber: { contains: q } },
      ],
    };
  }

  const members = await prisma.centerMembership.findMany({
    where,
    include: {
      user: { select: { id: true, name: true, email: true, mobileNumber: true, role: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  return NextResponse.json(members);
}

export async function POST(req: NextRequest, ctx: { params: Promise<Params> }) {
  const session = await requireSuperAdmin(req);
  if (!session) return NextResponse.json({ error: 'Super admin required' }, { status: 403 });

  const { id: centerId } = await ctx.params;
  const center = await prisma.center.findUnique({ where: { id: centerId } });
  if (!center) return NextResponse.json({ error: 'Center not found' }, { status: 404 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = MembershipCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 });
  }

  // Find or create the user. We prefer to match an existing user by id,
  // email, or mobile number; only mint a new one if none of those match.
  let user = null;
  if (parsed.data.userId) {
    user = await prisma.user.findUnique({ where: { id: parsed.data.userId } });
  } else if (parsed.data.email) {
    user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  } else if (parsed.data.mobileNumber) {
    user = await prisma.user.findUnique({ where: { mobileNumber: parsed.data.mobileNumber } });
  }

  if (!user) {
    if (!parsed.data.email && !parsed.data.mobileNumber) {
      return NextResponse.json(
        { error: 'User not found; provide email or mobileNumber to create one' },
        { status: 404 },
      );
    }
    // For COACH and SIDEARM_STAFF we accept user creation here — they
    // typically don't log in. For ADMIN/OPERATOR, require an existing
    // account so the auth flow has been exercised at least once.
    if (parsed.data.role === 'ADMIN' || parsed.data.role === 'OPERATOR') {
      return NextResponse.json(
        { error: `User not found. ${parsed.data.role}s must sign in once before being assigned.` },
        { status: 404 },
      );
    }
    user = await prisma.user.create({
      data: {
        name: parsed.data.name || (parsed.data.email ? parsed.data.email.split('@')[0] : null),
        email: parsed.data.email || null,
        mobileNumber: parsed.data.mobileNumber || null,
        authProvider: parsed.data.email ? 'GOOGLE' : 'OTP', // best-guess; may switch on first login
        role: parsed.data.role === 'COACH' ? 'COACH' : 'SIDEARM_STAFF',
      },
    });
  } else {
    // Promote the user's primary role if needed (e.g. a USER becomes a COACH).
    if (
      (parsed.data.role === 'COACH' || parsed.data.role === 'SIDEARM_STAFF')
      && user.role === 'USER'
    ) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { role: parsed.data.role },
      });
    }
    if (parsed.data.role === 'ADMIN' && user.role !== 'ADMIN') {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { role: 'ADMIN' },
      });
    }
    if (parsed.data.role === 'OPERATOR' && user.role !== 'OPERATOR' && user.role !== 'ADMIN') {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { role: 'OPERATOR' },
      });
    }
  }

  // Upsert the membership row — re-activate if a soft-deleted one exists.
  const existing = await prisma.centerMembership.findUnique({
    where: {
      userId_centerId_role: {
        userId: user.id,
        centerId,
        role: parsed.data.role,
      },
    },
  });

  const membership = existing
    ? await prisma.centerMembership.update({
        where: { id: existing.id },
        data: {
          isActive: true,
          metadata: (parsed.data.metadata as never) ?? existing.metadata,
        },
        include: { user: { select: { id: true, name: true, email: true, mobileNumber: true, role: true } } },
      })
    : await prisma.centerMembership.create({
        data: {
          centerId,
          userId: user.id,
          role: parsed.data.role,
          isActive: true,
          metadata: (parsed.data.metadata as never) ?? undefined,
        },
        include: { user: { select: { id: true, name: true, email: true, mobileNumber: true, role: true } } },
      });

  return NextResponse.json(membership, { status: existing ? 200 : 201 });
}
