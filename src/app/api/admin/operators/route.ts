import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/adminAuth';

const VALID_MACHINES = ['GRAVITY', 'YANTRA', 'LEVERAGE_INDOOR', 'LEVERAGE_OUTDOOR'];

const OPERATOR_QUERY = {
  where: { role: 'OPERATOR' as const },
  select: {
    id: true,
    name: true,
    email: true,
    mobileNumber: true,
    operatorPriority: true,
    operatorMorningPriority: true,
    operatorEveningPriority: true,
    operatorAssignments: { select: { id: true, machineId: true, days: true, createdAt: true } },
  },
  orderBy: { operatorPriority: 'asc' as const },
} as const;

// GET: List all operators with their machine assignments
export async function GET(req: NextRequest) {
  try {
    if (!(await requireAdmin(req))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }
    const operators = await prisma.user.findMany(OPERATOR_QUERY);

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

    return NextResponse.json({ operators });
  } catch (error: any) {
    console.error('Admin operators fetch error:', error);
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}

// POST: Assign a machine to an operator
export async function POST(req: NextRequest) {
  try {
    if (!(await requireAdmin(req))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }
    const { userId, machineId, days } = await req.json();
    if (!userId || !machineId) {
      return NextResponse.json({ error: 'userId and machineId are required' }, { status: 400 });
    }
    if (!VALID_MACHINES.includes(machineId)) {
      return NextResponse.json({ error: `Invalid machineId. Must be one of: ${VALID_MACHINES.join(', ')}` }, { status: 400 });
    }

    // Validate days array if provided
    if (days !== undefined && !Array.isArray(days)) {
      return NextResponse.json({ error: 'days must be an array of integers (0-6)' }, { status: 400 });
    }
    if (days !== undefined && days.some((d: any) => !Number.isInteger(d) || d < 0 || d > 6)) {
      return NextResponse.json({ error: 'days must contain integers 0-6 (0=Sun..6=Sat)' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    if (user.role !== 'OPERATOR') {
      return NextResponse.json({ error: 'User must have OPERATOR role before assigning machines' }, { status: 400 });
    }

    const assignment = await prisma.operatorAssignment.create({
      data: {
        userId,
        machineId,
        days: days || [],
      },
    });
    return NextResponse.json({ assignment }, { status: 201 });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return NextResponse.json({ error: 'This machine is already assigned to this operator' }, { status: 409 });
    }
    console.error('Admin operator assignment error:', error);
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}

// PATCH: Update operator priorities (bulk)
export async function PATCH(req: NextRequest) {
  try {
    if (!(await requireAdmin(req))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }
    const { operators } = await req.json();
    if (!Array.isArray(operators) || operators.length === 0) {
      return NextResponse.json({ error: 'operators array is required with { userId, priority } entries' }, { status: 400 });
    }

    await prisma.$transaction(
      operators.map((op: { userId: string; priority: number; morningPriority?: number; eveningPriority?: number }) =>
        prisma.user.update({
          where: { id: op.userId },
          data: {
            operatorPriority: op.priority,
            ...(op.morningPriority !== undefined ? { operatorMorningPriority: op.morningPriority } : {}),
            ...(op.eveningPriority !== undefined ? { operatorEveningPriority: op.eveningPriority } : {}),
          },
        })
      )
    );

    const updated = await prisma.user.findMany(OPERATOR_QUERY);
    return NextResponse.json({ operators: updated });
  } catch (error: any) {
    console.error('Admin operator priority update error:', error);
    return NextResponse.json({ error: error?.message || 'Failed to update operator priorities' }, { status: 500 });
  }
}

// PUT: Update days for an existing machine assignment
export async function PUT(req: NextRequest) {
  try {
    if (!(await requireAdmin(req))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }
    const { userId, machineId, days } = await req.json();
    if (!userId || !machineId) {
      return NextResponse.json({ error: 'userId and machineId are required' }, { status: 400 });
    }
    if (days === undefined) {
      return NextResponse.json({ error: 'days field is required' }, { status: 400 });
    }
    if (!Array.isArray(days)) {
      return NextResponse.json({ error: 'days must be an array of integers (0-6)' }, { status: 400 });
    }
    if (days.some((d: any) => !Number.isInteger(d) || d < 0 || d > 6)) {
      return NextResponse.json({ error: 'days must contain integers 0-6 (0=Sun..6=Sat)' }, { status: 400 });
    }

    const assignment = await prisma.operatorAssignment.update({
      where: { userId_machineId: { userId, machineId } },
      data: { days },
    });
    return NextResponse.json({ assignment });
  } catch (error: any) {
    if (error?.code === 'P2025') {
      return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
    }
    console.error('Admin operator update error:', error);
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}

// DELETE: Remove a machine assignment from an operator
export async function DELETE(req: NextRequest) {
  try {
    if (!(await requireAdmin(req))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }
    const { userId, machineId } = await req.json();
    if (!userId || !machineId) {
      return NextResponse.json({ error: 'userId and machineId are required' }, { status: 400 });
    }

    await prisma.operatorAssignment.delete({
      where: { userId_machineId: { userId, machineId } },
    });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error?.code === 'P2025') {
      return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
    }
    console.error('Admin operator unassignment error:', error);
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}
