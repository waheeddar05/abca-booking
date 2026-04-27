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
  };
  /**
   * Optional per-machine-type override for MACHINE bookings.
   * Keyed by `MachineType.code` (e.g. `YANTRA`, `LEVERAGE`).
   */
  machineTypeOverrides?: Record<string, PerSlabRates>;
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
  },
  machineTypeOverrides: {
    YANTRA: { morning: 800, evening: 1000 },
  },
};

export async function getResourcePricingConfig(centerId: string): Promise<ResourcePricingConfig> {
  return getPolicyJson('RESOURCE_PRICING_CONFIG', centerId, DEFAULT_RESOURCE_PRICING);
}

export interface PriceLookup {
  category: 'MACHINE' | 'SIDEARM' | 'COACHING' | 'FULL_COURT' | 'CORPORATE_BATCH';
  /** Required when category=MACHINE — used to apply Yantra/Leverage overrides. */
  machineTypeCode?: string | null;
  startTime: Date;
  /** Optional pre-fetched configs to avoid duplicate DB hits on grid endpoints. */
  centerId?: string;
  pricingConfig?: ResourcePricingConfig;
  timeSlabConfig?: TimeSlabConfig;
}

/**
 * Resolve the per-slot price for a resource-based booking.
 */
export async function getResourceSlotPrice(args: PriceLookup): Promise<number> {
  const pricing = args.pricingConfig
    ?? (args.centerId ? await getResourcePricingConfig(args.centerId) : DEFAULT_RESOURCE_PRICING);
  const timeSlabs = args.timeSlabConfig ?? (await getTimeSlabConfig());

  const slab = getTimeSlab(args.startTime, timeSlabs);

  if (args.category === 'MACHINE' && args.machineTypeCode) {
    const override = pricing.machineTypeOverrides?.[args.machineTypeCode];
    if (override && override[slab] != null) return override[slab];
  }

  const base = pricing.categoryRates[args.category];
  return base[slab];
}
