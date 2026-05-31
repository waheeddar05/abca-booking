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

import { getCenterOnlyPolicyJson } from '@/lib/policy';
import { getTimeSlab, getTimeSlabConfig, type TimeSlabConfig } from '@/lib/pricing';

export type TimeSlab = 'morning' | 'evening';

/**
 * A single slab rate. Two shapes accepted:
 *   - number              → flat rate, charged regardless of consecutive
 *   - { single, consecutive } → ABCA-style pair (consecutive used when
 *     a booking sits in a chain of back-to-back slots; single otherwise)
 *
 * Old policy values used numbers everywhere; the per-machine matrix
 * (added for Toplay parity with ABCA) uses the pair form. The engine
 * coerces both via `pickRate`.
 */
export type SlabRate = number | { single: number; consecutive: number };

export interface PerSlabRates {
  morning: SlabRate;
  evening: SlabRate;
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
   *   machineRowPricing[machineId][pitch][ball]   →  (most specific)
   *   machinePricing[code][pitch][ball]           →
   *   machinePricing[code][pitch]['*']            →
   *   machineTypeOverrides[code]                  →
   *   categoryRates.MACHINE
   * Use the literal `'*'` ball key for "any ball type" within a pitch.
   */
  machinePricing?: Record<string, Record<string, Record<string, PerSlabRates>>>;
  /**
   * MOST-SPECIFIC override: per-Machine-row pricing. Same shape as
   * `machinePricing` but keyed by `Machine.id` (the row at this
   * center) instead of `MachineType.code`. This is what lets a center
   * with two Yantra machines price each one separately.
   */
  machineRowPricing?: Record<string, Record<string, Record<string, PerSlabRates>>>;
  /** Per-pitch override for SIDEARM bookings. Falls back to categoryRates.SIDEARM. */
  sidearmPricing?: Record<string, PerSlabRates>;
  /** Per-pitch override for NET (cricket nets) bookings. Falls back to categoryRates.NET. */
  netPricing?: Record<string, PerSlabRates>;
  /** Per-pitch override for COACHING bookings. Falls back to coachingRate
   *  (pair-shaped category default) then categoryRates.COACHING. Mirrors
   *  the sidearm / net per-pitch shape the admin sees in the editor. */
  coachingPricing?: Record<string, PerSlabRates>;
  /** Category-level COACHING rate as a pair-shaped {single, consecutive}.
   *  Distinct from categoryRates.COACHING (which is the flat-number
   *  legacy default) so the 4-cell editor can write a real pair without
   *  having to widen every category rate. */
  coachingRate?: PerSlabRates;
  /** Same pattern for Full Indoor Court. Lets admins price the
   *  back-to-back court rental at a discount. */
  fullCourtRate?: PerSlabRates;
  /** Free-form notes the admin can leave for themselves. Not rendered. */
  notes?: string;
}

/**
 * Coerce a SlabRate (number or pair) to a single number based on
 * whether the booking sits in a consecutive chain of slots. Returns
 * null when the rate is missing/invalid so callers can fall back
 * down the precedence cascade.
 *
 * Convention (matches ABCA's pricing.ts + the admin editor's "2 Cons."
 * label): `consecutive` is the TOTAL for a 2-slot pair, so the per-slot
 * price in a chain is `consecutive / 2`. `single` is already per-slot.
 */
export function pickRate(r: SlabRate | undefined | null, isConsecutive: boolean): number | null {
  if (r == null) return null;
  if (typeof r === 'number') return r;
  if (typeof r === 'object') {
    if (isConsecutive) {
      // Use the consecutive pair total when it's been set (>0). Treating
      // 0 / missing as "admin didn't configure a consecutive discount"
      // lets the editor accept partial input (single only) without
      // accidentally making back-to-back bookings free. Falls back to
      // the per-slot single price when no consecutive total is present.
      if (typeof r.consecutive === 'number' && r.consecutive > 0) {
        return r.consecutive / 2;
      }
      return typeof r.single === 'number' && r.single > 0 ? r.single : null;
    }
    return typeof r.single === 'number' ? r.single : null;
  }
  return null;
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
  // RESOURCE_BASED centers are isolated from the global Policy table — the
  // pricing config must come from CenterPolicy only. This prevents ABCA's
  // PRICING_CONFIG (or any other platform-wide pricing knob) from leaking
  // into a Toplay-style center.
  return getCenterOnlyPolicyJson('RESOURCE_PRICING_CONFIG', centerId, DEFAULT_RESOURCE_PRICING);
}

export interface PriceLookup {
  category: 'MACHINE' | 'SIDEARM' | 'COACHING' | 'FULL_COURT' | 'CORPORATE_BATCH' | 'NET';
  /** Required when category=MACHINE — used to apply Yantra/Leverage overrides. */
  machineTypeCode?: string | null;
  /** Specific Machine row (Machine.id). Most-specific override axis;
   *  lets a center price two Yantra machines differently. */
  machineRowId?: string | null;
  /** Pitch type the user picked, when relevant (MACHINE / SIDEARM / NET). */
  pitchType?: string | null;
  /** Ball type the user picked, when relevant (MACHINE only). */
  ballType?: string | null;
  /** When true, pick the `consecutive` rate from a {single, consecutive}
   *  pair. Has no effect on flat-number rates. */
  isConsecutive?: boolean;
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
 *   machineRowPricing[machineId][pitch][ball] →  (Toplay: per-instance)
 *   machineRowPricing[machineId][pitch]['*']  →
 *   machinePricing[code][pitch][ball]         →  (per-machine-type)
 *   machinePricing[code][pitch]['*']          →
 *   machineTypeOverrides[code]                →
 *   categoryRates.MACHINE
 *
 * SIDEARM / NET:
 *   sidearmPricing[pitch] (or netPricing[pitch]) →
 *   categoryRates.{SIDEARM | NET}
 *
 * Other categories: categoryRates.{COACHING | FULL_COURT | CORPORATE_BATCH}.
 *
 * `isConsecutive` selects the `consecutive` field from `{single, consecutive}`
 * pair-shaped rates; flat numbers are unaffected.
 */
export async function getResourceSlotPrice(args: PriceLookup): Promise<number> {
  const pricing = args.pricingConfig
    ?? (args.centerId ? await getResourcePricingConfig(args.centerId) : DEFAULT_RESOURCE_PRICING);
  // Toplay-style centers are isolated from the global Policy table — pass
  // centerId + centerOnly so TIME_SLAB_CONFIG resolves from CenterPolicy
  // alone. When no centerId is known, fall through to the legacy global
  // lookup (used by ABCA's MACHINE_PITCH path).
  const timeSlabs = args.timeSlabConfig
    ?? (args.centerId
      ? await getTimeSlabConfig(args.centerId, true)
      : await getTimeSlabConfig());

  const slab = getTimeSlab(args.startTime, timeSlabs);
  const cons = !!args.isConsecutive;

  if (args.category === 'MACHINE') {
    const code = args.machineTypeCode ?? null;
    const rowId = args.machineRowId ?? null;
    const pitch = args.pitchType ?? null;
    const ball = args.ballType ?? null;

    // Per-Machine-row matrix (most specific). Two-Yantra centers use
    // this to price "Yantra 1" and "Yantra 2" separately.
    if (rowId) {
      if (pitch && ball) {
        const v = pricing.machineRowPricing?.[rowId]?.[pitch]?.[ball];
        const r = pickRate(v?.[slab], cons);
        if (r != null) return r;
      }
      if (pitch) {
        const v = pricing.machineRowPricing?.[rowId]?.[pitch]?.['*'];
        const r = pickRate(v?.[slab], cons);
        if (r != null) return r;
      }
    }

    if (code) {
      // Per-machine-type matrix (next-most specific)
      if (pitch && ball) {
        const v = pricing.machinePricing?.[code]?.[pitch]?.[ball];
        const r = pickRate(v?.[slab], cons);
        if (r != null) return r;
      }
      if (pitch) {
        const v = pricing.machinePricing?.[code]?.[pitch]?.['*'];
        const r = pickRate(v?.[slab], cons);
        if (r != null) return r;
      }
      // Coarse machine-type override (legacy)
      const legacy = pricing.machineTypeOverrides?.[code];
      const r = pickRate(legacy?.[slab], cons);
      if (r != null) return r;
    }
    return pickRate(pricing.categoryRates.MACHINE?.[slab], cons) ?? 0;
  }

  if (args.category === 'SIDEARM' && args.pitchType) {
    const v = pricing.sidearmPricing?.[args.pitchType];
    const r = pickRate(v?.[slab], cons);
    if (r != null) return r;
  }
  if (args.category === 'NET' && args.pitchType) {
    const v = pricing.netPricing?.[args.pitchType];
    const r = pickRate(v?.[slab], cons);
    if (r != null) return r;
  }
  // Coaching cascade: per-pitch override → pair-shaped category default
  // (coachingRate) → legacy categoryRates.COACHING fallback below.
  if (args.category === 'COACHING') {
    if (args.pitchType) {
      const v = pricing.coachingPricing?.[args.pitchType];
      const r = pickRate(v?.[slab], cons);
      if (r != null) return r;
    }
    const r = pickRate(pricing.coachingRate?.[slab], cons);
    if (r != null) return r;
  }
  // Full court pair-shaped category override → legacy fallback below.
  if (args.category === 'FULL_COURT') {
    const r = pickRate(pricing.fullCourtRate?.[slab], cons);
    if (r != null) return r;
  }

  return pickRate(pricing.categoryRates[args.category]?.[slab], cons) ?? 0;
}

/**
 * Best representative single-slot price for a category at a given slab.
 *
 * The discount PREVIEW (slot grid) needs a positive base price per
 * category to decide whether to show a recurring/promo discount and to
 * cap the flat amount. But the no-pitch category default
 * (`categoryRates[cat]`) is 0 for categories priced purely per-pitch —
 * the pricing editor exposes ONLY per-pitch inputs for SIDEARM / NET /
 * COACHING, so their real prices live in `sidearmPricing[pitch]` /
 * `netPricing[pitch]` / `coachingPricing[pitch]`.
 *
 * When that default is 0, the preview used to skip the category
 * (`basePrice <= 0`), so an "all categories" offer silently never showed
 * on those categories — making it look like the offer only applied to
 * bowling-machine bookings (MACHINE keeps a non-zero category default +
 * per-machine rates, so it was never skipped) — even though the booking
 * endpoint applies the discount against the real per-pitch price.
 *
 * This returns the max configured per-pitch / pair rate so the preview
 * can show the discount; the client caps the flat discount against the
 * user's actual pitch price once they pick one. Returns 0 only when the
 * category genuinely has no positive price configured anywhere.
 */
export function representativeCategoryBase(
  cat: PriceLookup['category'],
  pricing: ResourcePricingConfig,
  slab: TimeSlab,
): number {
  // The direct category default wins when it's positive.
  const direct = pickRate(pricing.categoryRates[cat]?.[slab], false) ?? 0;
  if (direct > 0) return direct;

  const maxOverPitch = (rec?: Record<string, PerSlabRates>): number => {
    if (!rec) return 0;
    let best = 0;
    for (const pitch of Object.keys(rec)) {
      const r = pickRate(rec[pitch]?.[slab], false);
      if (r != null && r > best) best = r;
    }
    return best;
  };

  switch (cat) {
    case 'SIDEARM':
      return maxOverPitch(pricing.sidearmPricing);
    case 'NET':
      return maxOverPitch(pricing.netPricing);
    case 'COACHING': {
      const perPitch = maxOverPitch(pricing.coachingPricing);
      const pair = pickRate(pricing.coachingRate?.[slab], false) ?? 0;
      return Math.max(perPitch, pair);
    }
    case 'FULL_COURT':
      return pickRate(pricing.fullCourtRate?.[slab], false) ?? 0;
    default:
      return 0;
  }
}
