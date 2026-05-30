import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireCenterAdmin } from '@/lib/adminAuth';
import { getAuthenticatedUser } from '@/lib/auth';
import { resolveCurrentCenter } from '@/lib/centers';
import type { MachineId } from '@prisma/client';

// Legacy enum values — accepted only when the active center is
// MACHINE_PITCH (ABCA-style). RESOURCE_BASED centers (Toplay) reference
// machines by `machineRowId` instead.
const VALID_LEGACY_MACHINES: readonly string[] = [
  'GRAVITY',
  'YANTRA',
  'LEVERAGE_INDOOR',
  'LEVERAGE_OUTDOOR',
];

function buildOperatorQuery(centerId: string | null) {
  return {
    // Source of truth for "is this user an operator at this center" is
    // `CenterMembership(role=OPERATOR, isActive=true)`. Using User.role
    // here missed two cases:
    //   - A user added via the Members tab whose existing User.role
    //     (e.g. ADMIN) outranked OPERATOR in the rank-bump ladder, so
    //     the role-promotion logic correctly left User.role alone.
    //   - The cross-center scenario where someone is an OPERATOR at
    //     center A and ADMIN at center B — only their membership rows
    //     can tell the two apart.
    // For the no-center fallback (super admin without a center selected),
    // match any active OPERATOR membership anywhere.
    where: centerId
      ? { centerMemberships: { some: { centerId, role: 'OPERATOR' as const, isActive: true } } }
      : { centerMemberships: { some: { role: 'OPERATOR' as const, isActive: true } } },
    select: {
      id: true,
      name: true,
      email: true,
      mobileNumber: true,
      operatorPriority: true,
      operatorMorningPriority: true,
      operatorEveningPriority: true,
      operatorDayPriorities: true,
      operatorAssignments: {
        where: centerId ? { centerId } : undefined,
        select: {
          id: true,
          machineId: true,
          machineRowId: true,
          days: true,
          createdAt: true,
          // Surfaces the assignable unit's display name to the UI for
          // RESOURCE_BASED centers — it has no enum to translate.
          machineRow: {
            select: {
              id: true,
              name: true,
              shortName: true,
              isActive: true,
              machineType: { select: { code: true, name: true } },
            },
          },
        },
      },
    },
    orderBy: { operatorPriority: 'asc' as const },
  };
}

// GET: List operators (filtered to admin's current center) with their assignments
export async function GET(req: NextRequest) {
  try {
    // Allow either super-admin or a center-admin AT THE RESOLVED
    // center. A user with `User.role=ADMIN` at center A can no longer
    // flip the cookie to center B and reshape their roster.
    const ctx = await requireCenterAdmin(req);
    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const allCenters = searchParams.get('allCenters') === 'true';
    const adminUser = await getAuthenticatedUser(req);
    const center = adminUser ? await resolveCurrentCenter(req, adminUser) : null;

    let centerId: string | null = null;
    if (!allCenters && center) {
      centerId = center.id;
    } else if (!allCenters && !center) {
      return NextResponse.json({ error: 'No center selected' }, { status: 400 });
    } else if (allCenters && !adminUser?.isSuperAdmin) {
      return NextResponse.json({ error: 'allCenters requires super admin' }, { status: 403 });
    }

    const operators = await prisma.user.findMany(buildOperatorQuery(centerId));

    // Auto-assign priority to new operators (priority 0) so they appear at the end
    const maxPriority = operators.reduce((max, op) => Math.max(max, op.operatorPriority), 0);
    let nextPriority = maxPriority;
    const needsUpdate: { id: string; priority: number }[] = [];

    for (const op of operators) {
      if (op.operatorPriority === 0) {
        nextPriority++;
        op.operatorPriority = nextPriority;
        needsUpdate.push({ id: op.id, priority: nextPriority });
      }
    }

    // Persist auto-assigned priorities so they're stable
    if (needsUpdate.length > 0) {
      await prisma.$transaction(
        needsUpdate.map(({ id, priority }) =>
          prisma.user.update({
            where: { id },
            data: { operatorPriority: priority },
          })
        )
      );
    }

    // Re-sort after priority assignment
    operators.sort((a, b) => a.operatorPriority - b.operatorPriority);

    return NextResponse.json({
      operators,
      // Hand the booking model to the client so the UI can render the
      // right machine picker without an extra request.
      bookingModel: center?.bookingModel ?? 'MACHINE_PITCH',
    });
  } catch (error: any) {
    console.error('Admin operators fetch error:', error);
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}

/**
 * Resolve which machine axis the request is referring to and validate
 * it against the center's booking model. Throws an Error with a user-
 * facing message on bad input — caller turns it into a 400.
 */
async function resolveMachineRef({
  centerId,
  bookingModel,
  machineId,
  machineRowId,
}: {
  centerId: string;
  bookingModel: 'MACHINE_PITCH' | 'RESOURCE_BASED';
  machineId?: string | null;
  machineRowId?: string | null;
}): Promise<{ machineId: MachineId | null; machineRowId: string | null }> {
  const hasLegacy = !!machineId;
  const hasRow = !!machineRowId;

  if (hasLegacy && hasRow) {
    throw new Error('Provide either machineId or machineRowId, not both');
  }
  if (!hasLegacy && !hasRow) {
    throw new Error('machineId or machineRowId is required');
  }

  if (hasLegacy) {
    if (bookingModel !== 'MACHINE_PITCH') {
      throw new Error('Legacy machineId is only valid for MACHINE_PITCH centers');
    }
    if (!VALID_LEGACY_MACHINES.includes(machineId!)) {
      throw new Error(
        `Invalid machineId. Must be one of: ${VALID_LEGACY_MACHINES.join(', ')}`,
      );
    }
    return { machineId: machineId as MachineId, machineRowId: null };
  }

  // hasRow
  if (bookingModel !== 'RESOURCE_BASED') {
    throw new Error('machineRowId is only valid for RESOURCE_BASED centers');
  }
  // Verify the row belongs to this center.
  const row = await prisma.machine.findUnique({
    where: { id: machineRowId! },
    select: { id: true, centerId: true, isActive: true },
  });
  if (!row || row.centerId !== centerId) {
    throw new Error('Machine not found at this center');
  }
  if (!row.isActive) {
    throw new Error('Machine is inactive');
  }
  return { machineId: null, machineRowId: row.id };
}

function validDays(days: unknown): number[] | null {
  if (days === undefined || days === null) return null;
  if (!Array.isArray(days)) return null;
  if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return null;
  return days as number[];
}

// POST: Assign a machine to an operator. Accepts either:
//   { userId, machineId }       — MACHINE_PITCH (legacy enum)
//   { userId, machineRowId }    — RESOURCE_BASED (Machine.id FK)
export async function POST(req: NextRequest) {
  try {
    // Allow either super-admin or a center-admin AT THE RESOLVED
    // center. A user with `User.role=ADMIN` at center A can no longer
    // flip the cookie to center B and reshape their roster.
    const ctx = await requireCenterAdmin(req);
    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }
    const body = await req.json();
    const { userId, machineId, machineRowId, days } = body as {
      userId?: string;
      machineId?: string;
      machineRowId?: string;
      days?: unknown;
    };

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    let parsedDays: number[] = [];
    if (days !== undefined && days !== null) {
      const v = validDays(days);
      if (v === null) {
        return NextResponse.json(
          { error: 'days must be an array of integers 0-6 (0=Sun..6=Sat)' },
          { status: 400 },
        );
      }
      parsedDays = v;
    }

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const admin = await getAuthenticatedUser(req);
    const center = admin ? await resolveCurrentCenter(req, admin) : null;
    if (!center) {
      return NextResponse.json({ error: 'No center selected' }, { status: 400 });
    }

    // Accept either:
    //  - The legacy global User.role = 'OPERATOR' (ABCA users predate
    //    multi-center memberships), or
    //  - An active CenterMembership(role=OPERATOR) for THIS center on UAT
    //    (where operators are granted per-center via the Members tab,
    //    not by promoting the global User.role).
    // Previously this guard only checked the global column, so any
    // operator who was added through the new center-membership flow
    // and never had their User.role bumped would be rejected here.
    let isOperatorAtCenter = user.role === 'OPERATOR';
    if (!isOperatorAtCenter) {
      const membership = await prisma.centerMembership.findUnique({
        where: {
          userId_centerId_role: {
            userId,
            centerId: center.id,
            role: 'OPERATOR',
          },
        },
        select: { isActive: true },
      });
      isOperatorAtCenter = !!membership?.isActive;
    }
    if (!isOperatorAtCenter) {
      return NextResponse.json(
        { error: 'User must have OPERATOR role at this center before assigning machines' },
        { status: 400 },
      );
    }

    let resolved;
    try {
      resolved = await resolveMachineRef({
        centerId: center.id,
        bookingModel: center.bookingModel,
        machineId,
        machineRowId,
      });
    } catch (e) {
      const m = e instanceof Error ? e.message : 'Invalid machine reference';
      return NextResponse.json({ error: m }, { status: 400 });
    }

    // Pre-check for duplicate (the partial unique index will catch it
    // too; checking up front gives a nicer 409 message).
    const existing = await prisma.operatorAssignment.findFirst({
      where: {
        centerId: center.id,
        userId,
        machineId: resolved.machineId,
        machineRowId: resolved.machineRowId,
      },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json(
        { error: 'This machine is already assigned to this operator' },
        { status: 409 },
      );
    }

    const assignment = await prisma.operatorAssignment.create({
      data: {
        centerId: center.id,
        userId,
        machineId: resolved.machineId,
        machineRowId: resolved.machineRowId,
        days: parsedDays,
      },
    });
    return NextResponse.json({ assignment }, { status: 201 });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return NextResponse.json(
        { error: 'This machine is already assigned to this operator' },
        { status: 409 },
      );
    }
    console.error('Admin operator assignment error:', error);
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}

// PATCH: Update operator priorities (bulk). Unrelated to machine refs,
// so the body shape is unchanged.
export async function PATCH(req: NextRequest) {
  try {
    // Allow either super-admin or a center-admin AT THE RESOLVED
    // center. A user with `User.role=ADMIN` at center A can no longer
    // flip the cookie to center B and reshape their roster.
    const ctx = await requireCenterAdmin(req);
    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }
    const { operators } = await req.json();
    if (!Array.isArray(operators) || operators.length === 0) {
      return NextResponse.json({ error: 'operators array is required with { userId, priority } entries' }, { status: 400 });
    }

    await prisma.$transaction(
      operators.map((op: { userId: string; priority: number; morningPriority?: number; eveningPriority?: number; dayPriorities?: Record<string, { morning: number; evening: number }> }) =>
        prisma.user.update({
          where: { id: op.userId },
          data: {
            operatorPriority: op.priority,
            ...(op.morningPriority !== undefined ? { operatorMorningPriority: op.morningPriority } : {}),
            ...(op.eveningPriority !== undefined ? { operatorEveningPriority: op.eveningPriority } : {}),
            ...(op.dayPriorities !== undefined ? { operatorDayPriorities: op.dayPriorities } : {}),
          },
        })
      )
    );

    // Re-fetch using the same center scope as the GET handler so the UI
    // sees a consistent list after a priority update.
    const adminUser = await getAuthenticatedUser(req);
    const center = adminUser ? await resolveCurrentCenter(req, adminUser) : null;
    const updated = await prisma.user.findMany(buildOperatorQuery(center?.id ?? null));
    return NextResponse.json({
      operators: updated,
      bookingModel: center?.bookingModel ?? 'MACHINE_PITCH',
    });
  } catch (error: any) {
    console.error('Admin operator priority update error:', error);
    return NextResponse.json({ error: error?.message || 'Failed to update operator priorities' }, { status: 500 });
  }
}

// PUT: Update days for an existing assignment. Body accepts either
// machineId (legacy) or machineRowId — exactly one.
export async function PUT(req: NextRequest) {
  try {
    // Allow either super-admin or a center-admin AT THE RESOLVED
    // center. A user with `User.role=ADMIN` at center A can no longer
    // flip the cookie to center B and reshape their roster.
    const ctx = await requireCenterAdmin(req);
    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }
    const { userId, machineId, machineRowId, days } = await req.json();
    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }
    if (days === undefined) {
      return NextResponse.json({ error: 'days field is required' }, { status: 400 });
    }
    const parsedDays = validDays(days);
    if (parsedDays === null) {
      return NextResponse.json(
        { error: 'days must be an array of integers 0-6 (0=Sun..6=Sat)' },
        { status: 400 },
      );
    }

    const admin = await getAuthenticatedUser(req);
    const center = admin ? await resolveCurrentCenter(req, admin) : null;
    if (!center) {
      return NextResponse.json({ error: 'No center selected' }, { status: 400 });
    }

    let resolved;
    try {
      resolved = await resolveMachineRef({
        centerId: center.id,
        bookingModel: center.bookingModel,
        machineId,
        machineRowId,
      });
    } catch (e) {
      const m = e instanceof Error ? e.message : 'Invalid machine reference';
      return NextResponse.json({ error: m }, { status: 400 });
    }

    // Partial uniques can't be used as `where unique` keys in Prisma —
    // findFirst by composite, then update by id.
    const row = await prisma.operatorAssignment.findFirst({
      where: {
        centerId: center.id,
        userId,
        machineId: resolved.machineId,
        machineRowId: resolved.machineRowId,
      },
      select: { id: true },
    });
    if (!row) {
      return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
    }

    const assignment = await prisma.operatorAssignment.update({
      where: { id: row.id },
      data: { days: parsedDays },
    });
    return NextResponse.json({ assignment });
  } catch (error: any) {
    console.error('Admin operator update error:', error);
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}

// DELETE: Remove an assignment. Body accepts either machineId or machineRowId.
export async function DELETE(req: NextRequest) {
  try {
    // Allow either super-admin or a center-admin AT THE RESOLVED
    // center. A user with `User.role=ADMIN` at center A can no longer
    // flip the cookie to center B and reshape their roster.
    const ctx = await requireCenterAdmin(req);
    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }
    const { userId, machineId, machineRowId } = await req.json();
    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    const admin = await getAuthenticatedUser(req);
    const center = admin ? await resolveCurrentCenter(req, admin) : null;
    if (!center) {
      return NextResponse.json({ error: 'No center selected' }, { status: 400 });
    }

    let resolved;
    try {
      resolved = await resolveMachineRef({
        centerId: center.id,
        bookingModel: center.bookingModel,
        machineId,
        machineRowId,
      });
    } catch (e) {
      const m = e instanceof Error ? e.message : 'Invalid machine reference';
      return NextResponse.json({ error: m }, { status: 400 });
    }

    const row = await prisma.operatorAssignment.findFirst({
      where: {
        centerId: center.id,
        userId,
        machineId: resolved.machineId,
        machineRowId: resolved.machineRowId,
      },
      select: { id: true },
    });
    if (!row) {
      return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
    }

    await prisma.operatorAssignment.delete({ where: { id: row.id } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Admin operator unassignment error:', error);
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}
