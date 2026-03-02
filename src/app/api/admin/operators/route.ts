import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/adminAuth';

// GET: List all operators with their machine assignments
export async function GET(req: NextRequest) {
  try {
    const session = await requireAdmin(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const operators = await prisma.user.findMany({
      where: { role: 'OPERATOR' },
      select: {
        id: true,
        name: true,
        email: true,
        mobileNumber: true,
        operatorAssignments: {
          select: {
            id: true,
            machineId: true,
            createdAt: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return NextResponse.json({ operators });
  } catch (error: any) {
    console.error('Admin operators fetch error:', error);
    return NextResponse.json(
      { error: error?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST: Assign a machine to an operator
export async function POST(req: NextRequest) {
  try {
    const session = await requireAdmin(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const body = await req.json();
    const { userId, machineId } = body;

    if (!userId || !machineId) {
      return NextResponse.json(
        { error: 'userId and machineId are required' },
        { status: 400 }
      );
    }

    // Validate the user exists and is an operator
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (user.role !== 'OPERATOR') {
      return NextResponse.json(
        { error: 'User must have OPERATOR role before assigning machines' },
        { status: 400 }
      );
    }

    // Validate the machineId
    const validMachines = ['GRAVITY', 'YANTRA', 'LEVERAGE_INDOOR', 'LEVERAGE_OUTDOOR'];
    if (!validMachines.includes(machineId)) {
      return NextResponse.json(
        { error: `Invalid machineId. Must be one of: ${validMachines.join(', ')}` },
        { status: 400 }
      );
    }

    // Create the assignment (@@unique constraint will prevent duplicates)
    const assignment = await prisma.operatorAssignment.create({
      data: {
        userId,
        machineId,
      },
    });

    return NextResponse.json({ assignment }, { status: 201 });
  } catch (error: any) {
    // Handle unique constraint violation
    if (error?.code === 'P2002') {
      return NextResponse.json(
        { error: 'This machine is already assigned to this operator' },
        { status: 409 }
      );
    }
    console.error('Admin operator assignment error:', error);
    return NextResponse.json(
      { error: error?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE: Remove a machine assignment from an operator
export async function DELETE(req: NextRequest) {
  try {
    const session = await requireAdmin(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const body = await req.json();
    const { userId, machineId } = body;

    if (!userId || !machineId) {
      return NextResponse.json(
        { error: 'userId and machineId are required' },
        { status: 400 }
      );
    }

    // Find and delete the assignment using the unique constraint
    const assignment = await prisma.operatorAssignment.findUnique({
      where: {
        userId_machineId: {
          userId,
          machineId,
        },
      },
    });

    if (!assignment) {
      return NextResponse.json(
        { error: 'Assignment not found' },
        { status: 404 }
      );
    }

    await prisma.operatorAssignment.delete({
      where: { id: assignment.id },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Admin operator unassignment error:', error);
    return NextResponse.json(
      { error: error?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
