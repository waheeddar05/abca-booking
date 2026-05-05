/**
 * Resource-based pricing.
 *
 * The legacy MACHINE_PITCH model in `src/lib/pricing.ts` covers ABCA: it
 * keys prices on (ball type × pitch type × time slab × consecutive flag).
 *
 * Resource-based centers like Toplay add new booking categories that
 * need their own price points. Rather than overload PRICING_CONFIG, we
 * keep this engine separate and read `RESOURCE_PRICING_CONFIG` (per
 * center via `getPolicyJson`).
 *
 * The shape is intentionally flat and easy to admin-edit: per-category
 * morning/evening rate, with optional per-machine override for MACHINE
 * bookings (so Yantra can cost more than Leverage at the same center).
 */

import { getPolicyJson } from '@/lib/policy';
import { getTimeSlab, getTimeSlabConfig, type TimeSlabConfig } from '@/lib/pricing';

export type TimeSlab = 'morning' | 'evening';

interface PerSlabRates {
  morning: number;
  evening: number;
}

export interface ResourcePricingConfig {
  /** Default per-category rate (per slot). Used when a more specific override isn't found. */
  categoryRates: {
    MACHINE: PerSlabRates;
    SIDEARM: PerSlabRates;
    COACHING: PerSlabRates;
    FULL_COURT: PerSlabRates;
    CORPORATE_BATCH: PerSlabRates;
    /** Bare-net booking — no machine, no staff, no coach. Cheapest tier. */
    NET: PerSlabRates;
  };
  /**
   * Optional per-machine-type override for MACHINE bookings (legacy
   * coarse override, kept for back-compat). Keyed by `MachineType.code`
   * (e.g. `YANTRA`, `LEVERAGE`). Used when the more specific
   * `machinePricing` matrix below has no matching entry.
   */
  machineTypeOverrides?: Record<string, PerSlabRates>;
  /**
   * Structured per-(machineType × pitch × ball) matrix for MACHINE
   * bookings. Mirrors the ABCA pricing config's specificity. Lookup
   * falls back to:
   *   machinePricing[code][pitch][ball]    →
   *   machinePricing[code][pitch]['*']     →
   *   machineTypeOverrides[code]           →
   *   categoryRates.MACHINE
   * Use the literal `'*'` ball key for "any ball type" within a pitch.
   */
  machinePricing?: Record<string, Record<string, Record<string, PerSlabRates>>>;
  /** Per-pitch override for SIDEARM bookings. Falls back to categoryRates.SIDEARM. */
  sidearmPricing?: Record<string, PerSlabRates>;
  /** Per-pitch override for NET (cricket nets) bookings. Falls back to categoryRates.NET. */
  netPricing?: Record<string, PerSlabRates>;
  /** Free-form notes the admin can leave for themselves. Not rendered. */
  notes?: string;
}

export const DEFAULT_RESOURCE_PRICING: ResourcePricingConfig = {
  categoryRates: {
    MACHINE:        { morning: 600, evening: 800 },
    SIDEARM:        { morning: 700, evening: 900 },
    COACHING:       { morning: 1000, evening: 1200 },
    FULL_COURT:     { morning: 2400, evening: 3200 },
    CORPORATE_BATCH:{ morning: 1500, evening: 1800 },
    NET:            { morning: 400, evening: 500 },
  },
  machineTypeOverrides: {
    YANTRA: { morning: 800, evening: 1000 },
  },
};

export async function getResourcePricingConfig(centerId: string): Promise<ResourcePricingConfig> {
  return getPolicyJson('RESOURCE_PRICING_CONFIG', centerId, DEFAULT_RESOURCE_PRICING);
}

export interface PriceLookup {
  category: 'MACHINE' | 'SIDEARM' | 'COACHING' | 'FULL_COURT' | 'CORPORATE_BATCH' | 'NET';
  /** Required when category=MACHINE — used to apply Yantra/Leverage overrides. */
  machineTypeCode?: string | null;
  /** Pitch type the user picked, when relevant (MACHINE / SIDEARM / NET). */
  pitchType?: string | null;
  /** Ball type the user picked, when relevant (MACHINE only). */
  ballType?: string | null;
  startTime: Date;
  /** Optional pre-fetched configs to avoid duplicate DB hits on grid endpoints. */
  centerId?: string;
  pricingConfig?: ResourcePricingConfig;
  timeSlabConfig?: TimeSlabConfig;
}

/**
 * Resolve the per-slot price for a resource-based booking. Walks from
 * most-specific override to category default:
 *
 * MACHINE:
 *   machinePricing[code][pitch][ball]   →
 *   machinePricing[code][pitch]['*']    →
 *   machineTypeOverrides[code]          →
 *   categoryRates.MACHINE
 *
 * SIDEARM / NET:
 *   sidearmPricing[pitch] (or netPricing[pitch]) →
 *   categoryRates.{SIDEARM | NET}
 *
 * Other categories: categoryRates.{COACHING | FULL_COURT | CORPORATE_BATCH}.
 */
export async function getResourceSlotPrice(args: PriceLookup): Promise<number> {
  const pricing = args.pricingConfig
    ?? (args.centerId ? await getResourcePricingConfig(args.centerId) : DEFAULT_RESOURCE_PRICING);
  const timeSlabs = args.timeSlabConfig ?? (await getTimeSlabConfig());

  const slab = getTimeSlab(args.startTime, timeSlabs);

  if (args.category === 'MACHINE') {
    const code = args.machineTypeCode ?? null;
    const pitch = args.pitchType ?? null;
    const ball = args.ballType ?? null;
    if (code) {
      // Specific (code, pitch, ball)
      if (pitch && ball) {
        const v = pricing.machinePricing?.[code]?.[pitch]?.[ball];
        if (v && v[slab] != null) return v[slab];
      }
      // Pitch-level override (any ball)
      if (pitch) {
        const v = pricing.machinePricing?.[code]?.[pitch]?.['*'];
        if (v && v[slab] != null) return v[slab];
      }
      // Coarse machine-type override (legacy)
      const legacy = pricing.machineTypeOverrides?.[code];
      if (legacy && legacy[slab] != null) return legacy[slab];
    }
    return pricing.categoryRates.MACHINE[slab];
  }

  if (args.category === 'SIDEARM' && args.pitchType) {
    const v = pricing.sidearmPricing?.[args.pitchType];
    if (v && v[slab] != null) return v[slab];
  }
  if (args.category === 'NET' && args.pitchType) {
    const v = pricing.netPricing?.[args.pitchType];
    if (v && v[slab] != null) return v[slab];
  }

  return pricing.categoryRates[args.category][slab];
}
