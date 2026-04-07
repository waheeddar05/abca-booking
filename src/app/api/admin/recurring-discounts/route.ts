import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/adminAuth';

// GET: List all recurring discount rules
export async function GET(req: NextRequest) {
  try {
    const session = await requireAdmin(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const rules = await prisma.recurringSlotDiscount.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ rules });
  } catch (error: any) {
    console.error('Recurring discounts fetch error:', error);
    return NextResponse.json(
      { error: error?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST: Create a new recurring discount rule
export async function POST(req: NextRequest) {
  try {
    const session = await requireAdmin(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const body = await req.json();
    const { days, slotStartTime, slotEndTime, machineIds, pitchTypes, oneSlotDiscount, twoSlotDiscount, enabled, appliesTo } = body;

    // Validation
    if (!Array.isArray(days) || days.length === 0) {
      return NextResponse.json({ error: 'days must be a non-empty array of day numbers (0-6)' }, { status: 400 });
    }
    if (!slotStartTime || !slotEndTime) {
      return NextResponse.json({ error: 'slotStartTime and slotEndTime are required (HH:MM format)' }, { status: 400 });
    }
    if (slotEndTime <= slotStartTime) {
      return NextResponse.json({ error: 'slotEndTime must be after slotStartTime (use 24-hour format, e.g. 15:00 for 3 PM)' }, { status: 400 });
    }
    if (typeof oneSlotDiscount !== 'number' || typeof twoSlotDiscount !== 'number') {
      return NextResponse.json({ error: 'oneSlotDiscount and twoSlotDiscount must be numbers' }, { status: 400 });
    }

    const validMachines = ['GRAVITY', 'YANTRA', 'LEVERAGE_INDOOR', 'LEVERAGE_OUTDOOR'];
    if (machineIds && Array.isArray(machineIds)) {
      for (const mid of machineIds) {
        if (!validMachines.includes(mid)) {
          return NextResponse.json({ error: `Invalid machineId. Must be one of: ${validMachines.join(', ')}` }, { status: 400 });
        }
      }
    }

    const validPitchTypes = ['ASTRO', 'CEMENT', 'NATURAL'];
    if (pitchTypes && Array.isArray(pitchTypes)) {
      for (const pt of pitchTypes) {
        if (!validPitchTypes.includes(pt)) {
          return NextResponse.json({ error: `Invalid pitchType. Must be one of: ${validPitchTypes.join(', ')}` }, { status: 400 });
        }
      }
    }

    const rule = await prisma.recurringSlotDiscount.create({
      data: {
        days: days.map(Number),
        slotStartTime,
        slotEndTime,
        machineIds: (machineIds || []) as any[],
        pitchTypes: (pitchTypes || []) as any[],
        oneSlotDiscount: Number(oneSlotDiscount),
        twoSlotDiscount: Number(twoSlotDiscount),
        enabled: enabled !== false,
        appliesTo: appliesTo || 'ALL',
      },
    });

    return NextResponse.json({ rule }, { status: 201 });
  } catch (error: any) {
    console.error('Create recurring discount error:', error);
    return NextResponse.json(
      { error: error?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
