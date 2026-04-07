import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/adminAuth';

// PUT: Update a recurring discount rule
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAdmin(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { id } = await params;
    const body = await req.json();
    const { days, slotStartTime, slotEndTime, machineIds, oneSlotDiscount, twoSlotDiscount, enabled, appliesTo } = body;

    const existing = await prisma.recurringSlotDiscount.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    }

    const validMachines = ['GRAVITY', 'YANTRA', 'LEVERAGE_INDOOR', 'LEVERAGE_OUTDOOR'];
    if (machineIds && Array.isArray(machineIds)) {
      for (const mid of machineIds) {
        if (!validMachines.includes(mid)) {
          return NextResponse.json({ error: `Invalid machineId` }, { status: 400 });
        }
      }
    }

    const rule = await prisma.recurringSlotDiscount.update({
      where: { id },
      data: {
        ...(days !== undefined ? { days: days.map(Number) } : {}),
        ...(slotStartTime !== undefined ? { slotStartTime } : {}),
        ...(slotEndTime !== undefined ? { slotEndTime } : {}),
        ...(machineIds !== undefined ? { machineIds: machineIds || [] } : {}),
        ...(oneSlotDiscount !== undefined ? { oneSlotDiscount: Number(oneSlotDiscount) } : {}),
        ...(twoSlotDiscount !== undefined ? { twoSlotDiscount: Number(twoSlotDiscount) } : {}),
        ...(enabled !== undefined ? { enabled: Boolean(enabled) } : {}),
        ...(appliesTo !== undefined ? { appliesTo } : {}),
      },
    });

    return NextResponse.json({ rule });
  } catch (error: any) {
    console.error('Update recurring discount error:', error);
    return NextResponse.json(
      { error: error?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE: Remove a recurring discount rule
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAdmin(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { id } = await params;

    const existing = await prisma.recurringSlotDiscount.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    }

    await prisma.recurringSlotDiscount.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Delete recurring discount error:', error);
    return NextResponse.json(
      { error: error?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
