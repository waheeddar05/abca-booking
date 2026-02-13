import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { DEFAULT_PRICING_CONFIG, DEFAULT_TIME_SLABS } from '@/lib/pricing';
import type { PricingConfig, TimeSlabConfig } from '@/lib/pricing';

const MACHINE_CONFIG_KEYS = [
  'BALL_TYPE_SELECTION_ENABLED',
  'LEATHER_BALL_EXTRA_CHARGE',
  'MACHINE_BALL_EXTRA_CHARGE',
  'PITCH_TYPE_SELECTION_ENABLED',
  'ASTRO_PITCH_PRICE',
  'TURF_PITCH_PRICE',
  'DEFAULT_SLOT_PRICE',
  'NUMBER_OF_OPERATORS',
  'PRICING_CONFIG',
  'TIME_SLAB_CONFIG',
];

export async function GET() {
  try {
    const policies = await prisma.policy.findMany({
      where: { key: { in: MACHINE_CONFIG_KEYS } },
    });

    const config: Record<string, string> = {};
    for (const p of policies) {
      config[p.key] = p.value;
    }

    let pricingConfig: PricingConfig = DEFAULT_PRICING_CONFIG;
    if (config['PRICING_CONFIG']) {
      try {
        pricingConfig = JSON.parse(config['PRICING_CONFIG']);
      } catch { /* use default */ }
    }

    let timeSlabConfig: TimeSlabConfig = DEFAULT_TIME_SLABS;
    if (config['TIME_SLAB_CONFIG']) {
      try {
        timeSlabConfig = JSON.parse(config['TIME_SLAB_CONFIG']);
      } catch { /* use default */ }
    }

    return NextResponse.json({
      leatherMachine: {
        ballTypeSelectionEnabled: config['BALL_TYPE_SELECTION_ENABLED'] === 'true',
        leatherBallExtraCharge: parseFloat(config['LEATHER_BALL_EXTRA_CHARGE'] || '100'),
        machineBallExtraCharge: parseFloat(config['MACHINE_BALL_EXTRA_CHARGE'] || '0'),
      },
      tennisMachine: {
        pitchTypeSelectionEnabled: config['PITCH_TYPE_SELECTION_ENABLED'] === 'true',
        astroPitchPrice: parseFloat(config['ASTRO_PITCH_PRICE'] || '600'),
        turfPitchPrice: parseFloat(config['TURF_PITCH_PRICE'] || '700'),
      },
      defaultSlotPrice: parseFloat(config['DEFAULT_SLOT_PRICE'] || '600'),
      numberOfOperators: parseInt(config['NUMBER_OF_OPERATORS'] || '1', 10),
      pricingConfig,
      timeSlabConfig,
    });
  } catch (error: any) {
    console.error('Public machine config fetch error:', error);
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}
