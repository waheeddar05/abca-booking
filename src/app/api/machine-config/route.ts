import { NextResponse } from 'next/server';
import { DEFAULT_PRICING_CONFIG, DEFAULT_TIME_SLABS, normalizePricingConfig } from '@/lib/pricing';
import type { PricingConfig, TimeSlabConfig } from '@/lib/pricing';
import { DEFAULT_MACHINE_PITCH_CONFIG, MACHINES, ALL_MACHINE_IDS } from '@/lib/constants';
import type { MachinePitchConfig } from '@/lib/constants';
import { getCachedPolicies } from '@/lib/policy-cache';

const MACHINE_CONFIG_KEYS = [
  'BALL_TYPE_SELECTION_ENABLED',
  'LEATHER_PITCH_TYPE_SELECTION_ENABLED',
  'LEATHER_BALL_EXTRA_CHARGE',
  'MACHINE_BALL_EXTRA_CHARGE',
  'PITCH_TYPE_SELECTION_ENABLED',
  'ASTRO_PITCH_PRICE',
  'TURF_PITCH_PRICE',
  'DEFAULT_SLOT_PRICE',
  'NUMBER_OF_OPERATORS',
  'PRICING_CONFIG',
  'TIME_SLAB_CONFIG',
  'MACHINE_PITCH_CONFIG',
];

export async function GET() {
  try {
    const config = await getCachedPolicies(MACHINE_CONFIG_KEYS);

    let pricingConfig: PricingConfig = DEFAULT_PRICING_CONFIG;
    if (config['PRICING_CONFIG']) {
      try {
        pricingConfig = normalizePricingConfig(JSON.parse(config['PRICING_CONFIG']));
      } catch { /* use default */ }
    }

    let timeSlabConfig: TimeSlabConfig = DEFAULT_TIME_SLABS;
    if (config['TIME_SLAB_CONFIG']) {
      try {
        timeSlabConfig = JSON.parse(config['TIME_SLAB_CONFIG']);
      } catch { /* use default */ }
    }

    let machinePitchConfig: MachinePitchConfig = DEFAULT_MACHINE_PITCH_CONFIG;
    if (config['MACHINE_PITCH_CONFIG']) {
      try {
        machinePitchConfig = JSON.parse(config['MACHINE_PITCH_CONFIG']);
      } catch { /* use default */ }
    }

    // Build per-machine info for the frontend
    const machines = ALL_MACHINE_IDS.map(id => {
      const def = MACHINES[id];
      // An empty array is truthy in JS, so a plain `|| def.defaultPitchTypes`
      // would NOT fall back and would leave a machine with zero pitch types —
      // which hides the Pitch Type selector in the booking UI. Fall back to the
      // machine's defaults whenever the override is missing or empty.
      const configured = machinePitchConfig[id];
      const enabledPitchTypes = Array.isArray(configured) && configured.length > 0
        ? configured
        : def.defaultPitchTypes;
      return {
        id: def.id,
        name: def.name,
        shortName: def.shortName,
        ballType: def.ballType,
        category: def.category,
        enabledPitchTypes,
      };
    });

    return NextResponse.json({
      // New machine-centric config
      machines,
      machinePitchConfig,

      // Legacy fields (kept for backward compatibility)
      leatherMachine: {
        ballTypeSelectionEnabled: config['BALL_TYPE_SELECTION_ENABLED'] === 'true',
        pitchTypeSelectionEnabled: config['LEATHER_PITCH_TYPE_SELECTION_ENABLED'] === 'true',
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
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    });
  } catch (error) {
    console.error('Public machine config fetch error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
