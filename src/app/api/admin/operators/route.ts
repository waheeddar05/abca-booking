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
    operatorAssignments: { select: { id: true, machineId: true, createdAt: true } },
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
    const { userId, machineId } = await req.json();
    if (!userId || !machineId) {
      return NextResponse.json({ error: 'userId and machineId are required' }, { status: 400 });
    }
    if (!VALID_MACHINES.includes(machineId)) {
      return NextResponse.json({ error: `Invalid machineId. Must be one of: ${VALID_MACHINES.join(', ')}` }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    if (user.role !== 'OPERATOR') {
      return NextResponse.json({ error: 'User must have OPERATOR role before assigning machines' }, { status: 400 });
    }

    const assignment = await prisma.operatorAssignment.create({ data: { userId, machineId } });
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
