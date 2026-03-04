import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/adminAuth';
import { getCachedPolicies, invalidatePolicyCache } from '@/lib/policy-cache';

const DISCOUNT_KEYS = [
  'CONSECUTIVE_DISCOUNT_ENABLED',
  'CONSECUTIVE_DISCOUNT_MIN_SLOTS',
  'CONSECUTIVE_DISCOUNT_TYPE',
  'CONSECUTIVE_DISCOUNT_VALUE',
  'DEFAULT_SLOT_PRICE',
];

export async function GET(req: NextRequest) {
  try {
    const session = await requireAdmin(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const config = await getCachedPolicies(DISCOUNT_KEYS);

    return NextResponse.json({
      enabled: config['CONSECUTIVE_DISCOUNT_ENABLED'] === 'true',
      minSlots: parseInt(config['CONSECUTIVE_DISCOUNT_MIN_SLOTS'] || '2'),
      discountType: config['CONSECUTIVE_DISCOUNT_TYPE'] || 'PERCENTAGE',
      discountValue: parseFloat(config['CONSECUTIVE_DISCOUNT_VALUE'] || '0'),
      defaultSlotPrice: parseFloat(config['DEFAULT_SLOT_PRICE'] || '600'),
    });
  } catch (error: any) {
    console.error('Discount config fetch error:', error);
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAdmin(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { enabled, minSlots, discountType, discountValue, defaultSlotPrice } = await req.json();

    if (discountType && !['PERCENTAGE', 'FIXED'].includes(discountType)) {
      return NextResponse.json({ error: 'Discount type must be PERCENTAGE or FIXED' }, { status: 400 });
    }

    if (discountType === 'PERCENTAGE' && discountValue !== undefined && (discountValue < 0 || discountValue > 100)) {
      return NextResponse.json({ error: 'Percentage discount must be between 0 and 100' }, { status: 400 });
    }

    const updates: Array<{ key: string; value: string }> = [];

    if (enabled !== undefined) updates.push({ key: 'CONSECUTIVE_DISCOUNT_ENABLED', value: String(enabled) });
    if (minSlots !== undefined) updates.push({ key: 'CONSECUTIVE_DISCOUNT_MIN_SLOTS', value: String(minSlots) });
    if (discountType !== undefined) updates.push({ key: 'CONSECUTIVE_DISCOUNT_TYPE', value: discountType });
    if (discountValue !== undefined) updates.push({ key: 'CONSECUTIVE_DISCOUNT_VALUE', value: String(discountValue) });
    if (defaultSlotPrice !== undefined) updates.push({ key: 'DEFAULT_SLOT_PRICE', value: String(defaultSlotPrice) });

    await Promise.all(
      updates.map(({ key, value }) =>
        prisma.policy.upsert({
          where: { key },
          update: { value },
          create: { key, value },
        })
      )
    );

    invalidatePolicyCache(...updates.map(u => u.key));

    return NextResponse.json({ message: 'Discount configuration updated successfully' });
  } catch (error: any) {
    console.error('Discount config update error:', error);
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}
