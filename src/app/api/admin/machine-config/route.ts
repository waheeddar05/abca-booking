import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/adminAuth';
import { DEFAULT_PRICING_CONFIG, DEFAULT_TIME_SLABS } from '@/lib/pricing';
import type { PricingConfig, TimeSlabConfig } from '@/lib/pricing';

const MACHINE_CONFIG_KEYS = [
  'BALL_TYPE_SELECTION_ENABLED',
  'LEATHER_BALL_EXTRA_CHARGE',
  'MACHINE_BALL_EXTRA_CHARGE',
  'PITCH_TYPE_SELECTION_ENABLED',
  'ASTRO_PITCH_PRICE',
  'TURF_PITCH_PRICE',
  'NUMBER_OF_OPERATORS',
  'PRICING_CONFIG',
  'TIME_SLAB_CONFIG',
];

export async function GET(req: NextRequest) {
  try {
    const session = await requireAdmin(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

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
      numberOfOperators: parseInt(config['NUMBER_OF_OPERATORS'] || '1', 10),
      pricingConfig,
      timeSlabConfig,
    });
  } catch (error: any) {
    console.error('Machine config fetch error:', error);
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAdmin(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const body = await req.json();
    const { leatherMachine, tennisMachine, numberOfOperators, pricingConfig, timeSlabConfig } = body;

    const updates: Array<{ key: string; value: string }> = [];

    if (leatherMachine) {
      if (leatherMachine.ballTypeSelectionEnabled !== undefined) {
        updates.push({ key: 'BALL_TYPE_SELECTION_ENABLED', value: String(leatherMachine.ballTypeSelectionEnabled) });
      }
      if (leatherMachine.leatherBallExtraCharge !== undefined) {
        updates.push({ key: 'LEATHER_BALL_EXTRA_CHARGE', value: String(leatherMachine.leatherBallExtraCharge) });
      }
      if (leatherMachine.machineBallExtraCharge !== undefined) {
        updates.push({ key: 'MACHINE_BALL_EXTRA_CHARGE', value: String(leatherMachine.machineBallExtraCharge) });
      }
    }

    if (tennisMachine) {
      if (tennisMachine.pitchTypeSelectionEnabled !== undefined) {
        updates.push({ key: 'PITCH_TYPE_SELECTION_ENABLED', value: String(tennisMachine.pitchTypeSelectionEnabled) });
      }
      if (tennisMachine.astroPitchPrice !== undefined) {
        updates.push({ key: 'ASTRO_PITCH_PRICE', value: String(tennisMachine.astroPitchPrice) });
      }
      if (tennisMachine.turfPitchPrice !== undefined) {
        updates.push({ key: 'TURF_PITCH_PRICE', value: String(tennisMachine.turfPitchPrice) });
      }
    }

    if (numberOfOperators !== undefined) {
      const val = Math.max(1, Math.floor(Number(numberOfOperators)));
      updates.push({ key: 'NUMBER_OF_OPERATORS', value: String(val) });
    }

    if (pricingConfig !== undefined) {
      updates.push({ key: 'PRICING_CONFIG', value: JSON.stringify(pricingConfig) });
    }

    if (timeSlabConfig !== undefined) {
      updates.push({ key: 'TIME_SLAB_CONFIG', value: JSON.stringify(timeSlabConfig) });
    }

    for (const { key, value } of updates) {
      await prisma.policy.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      });
    }

    return NextResponse.json({ message: 'Machine configuration updated successfully' });
  } catch (error: any) {
    console.error('Machine config update error:', error);
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}
