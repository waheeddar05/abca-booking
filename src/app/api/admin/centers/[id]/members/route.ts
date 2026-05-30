import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireCenterAdminForCenter } from '@/lib/adminAuth';
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

const RoleEnum = z.enum(['ADMIN', 'OPERATOR', 'COACH', 'SIDEARM_SPECIALIST', 'GROUND_STAFF']);

// Backwards-compatible: the legacy `role` (single) keeps working; the
// new `roles` (array) is preferred for the multi-role assign UI. At
// least one must be provided. The handler normalises both forms into
// a deduped array of roles to create.
const MembershipCreateSchema = z.object({
  role: RoleEnum.optional(),
  // Bumped from 4 to 5 to allow the new GROUND_STAFF role alongside
  // ADMIN / OPERATOR / COACH / SIDEARM_SPECIALIST when an admin
  // assigns multiple roles to the same user in one go.
  roles: z.array(RoleEnum).max(5).optional(),
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
).refine(
  (d) => d.role || (d.roles && d.roles.length > 0),
  { message: 'Provide role or roles[]' },
);

type Params = { id: string };

export async function GET(req: NextRequest, ctx: { params: Promise<Params> }) {
  const { id: centerId } = await ctx.params;
  const ctxAuth = await requireCenterAdminForCenter(req, centerId);
  if (!ctxAuth) return NextResponse.json({ error: 'Admin required' }, { status: 403 });
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

  // The Sidearm admin tab (and any future role-list view) needs more
  // than just the membership row — it wants the priority field and
  // the resolved availability windows (weekly + date-range) so the
  // editor can show "Specialist A — priority 1, recurring Mon–Fri
  // 17:00–21:00, plus 10–20 June 18:00–22:00". Including those by
  // default keeps the Members tab response slightly heavier but
  // saves an N+1 fetch for the Sidearm view.
  const members = await prisma.centerMembership.findMany({
    where,
    include: {
      user: { select: { id: true, name: true, email: true, mobileNumber: true, role: true } },
      availability: {
        where: { isActive: true },
        select: { id: true, dayOfWeek: true, startTime: true, endTime: true },
        orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
      },
      dateAvailability: {
        where: { isActive: true },
        select: { id: true, fromDate: true, toDate: true, startTime: true, endTime: true, label: true },
        orderBy: [{ fromDate: 'asc' }],
      },
    },
    orderBy: [
      // Priority-first so the Sidearm tab renders ranked specialists
      // in the right order without an extra client-side sort.
      { priority: 'asc' },
      { createdAt: 'asc' },
    ],
  });
  return NextResponse.json(members);
}

export async function POST(req: NextRequest, ctx: { params: Promise<Params> }) {
  const { id: centerId } = await ctx.params;
  const ctxAuth = await requireCenterAdminForCenter(req, centerId);
  if (!ctxAuth) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

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

  // Normalise role / roles into a single deduped list.
  const rolesToAssign = Array.from(
    new Set(parsed.data.roles && parsed.data.roles.length > 0 ? parsed.data.roles : [parsed.data.role!]),
  );

  // Center admins can grant OPERATOR / COACH / SIDEARM_SPECIALIST. ADMIN
  // remains super-admin-only so a center admin can't promote someone to
  // peer them.
  if (!ctxAuth.isSuperAdmin && rolesToAssign.includes('ADMIN')) {
    return NextResponse.json(
      { error: 'Only super admin can grant the ADMIN role.' },
      { status: 403 },
    );
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
    // ADMIN / OPERATOR require an existing account (auth flow exercised
    // at least once). COACH / SIDEARM_SPECIALIST / GROUND_STAFF may be
    // created here — admins typically onboard these center-side staff
    // before they ever sign in themselves.
    const requiresExisting = rolesToAssign.some((r) => r === 'ADMIN' || r === 'OPERATOR');
    if (requiresExisting) {
      return NextResponse.json(
        { error: 'User not found. ADMIN/OPERATOR must sign in once before being assigned.' },
        { status: 404 },
      );
    }
    // Pick a primary platform role for the new user. COACH wins over
    // SIDEARM_SPECIALIST when both are assigned, since coaches are more
    // visible. GROUND_STAFF is a center-side facility role — it doesn't
    // correspond to a UserRole, so we fall back to plain USER and let
    // the CenterMembership row carry the GROUND_STAFF authorisation.
    const primary: 'COACH' | 'SIDEARM_SPECIALIST' | 'USER' = rolesToAssign.includes('COACH')
      ? 'COACH'
      : rolesToAssign.includes('SIDEARM_SPECIALIST')
        ? 'SIDEARM_SPECIALIST'
        : 'USER';
    user = await prisma.user.create({
      data: {
        name: parsed.data.name || (parsed.data.email ? parsed.data.email.split('@')[0] : null),
        email: parsed.data.email || null,
        mobileNumber: parsed.data.mobileNumber || null,
        authProvider: parsed.data.email ? 'GOOGLE' : 'OTP',
        role: primary,
      },
    });
  } else {
    // Bump the user's primary platform role if any of the assigned
    // roles is more privileged than what they have today. Membership
    // rows below stay as the source of truth for per-role authorisation.
    // GROUND_STAFF is a center-side facility role with no UserRole
    // equivalent — skip it entirely in the rank promotion.
    const order = ['USER', 'COACH', 'SIDEARM_SPECIALIST', 'OPERATOR', 'ADMIN'] as const;
    type OrderRole = (typeof order)[number];
    const currentRank = order.indexOf(user.role as OrderRole);
    let highestRank = currentRank;
    for (const r of rolesToAssign) {
      if (r === 'GROUND_STAFF') continue;
      const rank = order.indexOf(r as OrderRole);
      if (rank > highestRank) highestRank = rank;
    }
    if (highestRank > currentRank) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { role: order[highestRank] },
      });
    }
  }

  // Upsert one membership row per requested role. Reactivates any
  // soft-deleted rows. Returns the full set so the client can render
  // the user with all their role chips immediately.
  const memberships = [];
  for (const role of rolesToAssign) {
    const existing = await prisma.centerMembership.findUnique({
      where: {
        userId_centerId_role: { userId: user.id, centerId, role },
      },
    });
    const m = existing
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
            role,
            isActive: true,
            metadata: (parsed.data.metadata as never) ?? undefined,
          },
          include: { user: { select: { id: true, name: true, email: true, mobileNumber: true, role: true } } },
        });
    memberships.push(m);
  }

  // Legacy single-role callers expected a single object; multi-role
  // callers expect an array. Detect by what they sent.
  if (parsed.data.roles && parsed.data.roles.length > 0) {
    return NextResponse.json(memberships, { status: 201 });
  }
  return NextResponse.json(memberships[0], { status: 201 });
}
