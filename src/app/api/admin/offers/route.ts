import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/adminAuth';
import { DiscountType, MachineId, PitchType } from '@prisma/client';
import { z } from 'zod';

// Validation schema
const CreateOfferSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  startDate: z.string().refine(d => !isNaN(Date.parse(d)), 'Invalid start date'),
  endDate: z.string().refine(d => !isNaN(Date.parse(d)), 'Invalid end date'),
  timeSlotStart: z.string().nullable().optional(),
  timeSlotEnd: z.string().nullable().optional(),
  days: z.array(z.number().min(0).max(6)).optional().default([]),
  machineId: z.enum(['GRAVITY', 'YANTRA', 'LEVERAGE_INDOOR', 'LEVERAGE_OUTDOOR']).nullable().optional(),
  pitchType: z.enum(['ASTRO', 'CEMENT', 'NATURAL']).nullable().optional(),
  discountType: z.enum(['PERCENTAGE', 'FIXED']),
  discountValue: z.number().positive('Discount value must be positive'),
  isActive: z.boolean().optional().default(true),
});

const OFFER_SELECT = {
  id: true,
  name: true,
  startDate: true,
  endDate: true,
  timeSlotStart: true,
  timeSlotEnd: true,
  days: true,
  machineId: true,
  pitchType: true,
  discountType: true,
  discountValue: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

// GET: List all offers
export async function GET(req: NextRequest) {
  try {
    if (!(await requireAdmin(req))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const offers = await prisma.promotionalOffer.findMany({
      select: OFFER_SELECT,
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(offers);
  } catch (error) {
    console.error('Admin offers fetch error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST: Create a new offer
export async function POST(req: NextRequest) {
  try {
    if (!(await requireAdmin(req))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const body = await req.json();
    const parsed = CreateOfferSchema.parse(body);

    // Validate dates
    const startDate = new Date(parsed.startDate);
    const endDate = new Date(parsed.endDate);
    if (startDate > endDate) {
      return NextResponse.json({ error: 'Start date must be before end date' }, { status: 400 });
    }

    // Validate discount value
    if (parsed.discountType === 'PERCENTAGE' && parsed.discountValue > 100) {
      return NextResponse.json({ error: 'Percentage discount cannot exceed 100' }, { status: 400 });
    }

    // Validate time slots if provided
    if (parsed.timeSlotStart && parsed.timeSlotEnd) {
      const timeRegex = /^\d{2}:\d{2}$/;
      if (!timeRegex.test(parsed.timeSlotStart) || !timeRegex.test(parsed.timeSlotEnd)) {
        return NextResponse.json({ error: 'Time slots must be in HH:MM format' }, { status: 400 });
      }
    }

    const offer = await prisma.promotionalOffer.create({
      data: {
        name: parsed.name,
        startDate: new Date(parsed.startDate).toISOString().split('T')[0], // Store as date only
        endDate: new Date(parsed.endDate).toISOString().split('T')[0], // Store as date only
        timeSlotStart: parsed.timeSlotStart || null,
        timeSlotEnd: parsed.timeSlotEnd || null,
        days: parsed.days || [],
        machineId: (parsed.machineId || null) as MachineId | null,
        pitchType: (parsed.pitchType || null) as PitchType | null,
        discountType: parsed.discountType as DiscountType,
        discountValue: parsed.discountValue,
        isActive: parsed.isActive ?? true,
      },
      select: OFFER_SELECT,
    });

    return NextResponse.json(offer, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 });
    }
    console.error('Admin offer creation error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PATCH: Update an offer by id
export async function PATCH(req: NextRequest) {
  try {
    if (!(await requireAdmin(req))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const body = await req.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: 'ID is required' }, { status: 400 });
    }

    // Validate dates if provided
    if (updates.startDate && updates.endDate) {
      const startDate = new Date(updates.startDate);
      const endDate = new Date(updates.endDate);
      if (startDate > endDate) {
        return NextResponse.json({ error: 'Start date must be before end date' }, { status: 400 });
      }
    }

    // Validate discount value if provided
    if (updates.discountValue !== undefined && updates.discountValue <= 0) {
      return NextResponse.json({ error: 'Discount value must be positive' }, { status: 400 });
    }
    if (updates.discountType === 'PERCENTAGE' && updates.discountValue > 100) {
      return NextResponse.json({ error: 'Percentage discount cannot exceed 100' }, { status: 400 });
    }

    // Validate time slots if provided
    if (updates.timeSlotStart || updates.timeSlotEnd) {
      const timeRegex = /^\d{2}:\d{2}$/;
      if (updates.timeSlotStart && !timeRegex.test(updates.timeSlotStart)) {
        return NextResponse.json({ error: 'Time slots must be in HH:MM format' }, { status: 400 });
      }
      if (updates.timeSlotEnd && !timeRegex.test(updates.timeSlotEnd)) {
        return NextResponse.json({ error: 'Time slots must be in HH:MM format' }, { status: 400 });
      }
    }

    // Convert dates to date-only format if provided
    type UpdateData = Record<string, unknown>;
    const dataToUpdate: UpdateData = { ...updates };
    if (updates.startDate) {
      dataToUpdate.startDate = new Date(updates.startDate as string).toISOString().split('T')[0];
    }
    if (updates.endDate) {
      dataToUpdate.endDate = new Date(updates.endDate as string).toISOString().split('T')[0];
    }

    const offer = await prisma.promotionalOffer.update({
      where: { id },
      data: dataToUpdate,
      select: OFFER_SELECT,
    });

    return NextResponse.json(offer);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'P2025') {
      return NextResponse.json({ error: 'Offer not found' }, { status: 404 });
    }
    console.error('Admin offer update error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE: Delete an offer by id
export async function DELETE(req: NextRequest) {
  try {
    if (!(await requireAdmin(req))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'ID is required' }, { status: 400 });
    }

    await prisma.promotionalOffer.delete({ where: { id } });

    return NextResponse.json({ message: 'Offer deleted successfully' });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'P2025') {
      return NextResponse.json({ error: 'Offer not found' }, { status: 404 });
    }
    console.error('Admin offer deletion error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
