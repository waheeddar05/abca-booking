import { describe, it, expect } from 'vitest';
import { representativeCategoryBase } from '@/lib/resource-pricing';
import type { ResourcePricingConfig } from '@/lib/resource-pricing';

/**
 * Regression guard for "offer only applies to bowling machines".
 *
 * The pricing editor exposes only per-pitch inputs for SIDEARM / NET /
 * COACHING, so a center can have a 0 `categoryRates` default for them
 * while the real price lives in `sidearmPricing[pitch]` etc. The slot
 * grid's discount preview used `categoryRates[cat]` (0) as the base and
 * skipped those categories, hiding the offer. `representativeCategoryBase`
 * must surface a positive base from the per-pitch rates so the preview
 * shows the discount.
 */
const perPitchOnly: ResourcePricingConfig = {
  categoryRates: {
    MACHINE: { morning: 600, evening: 800 },
    SIDEARM: { morning: 0, evening: 0 },
    COACHING: { morning: 0, evening: 0 },
    FULL_COURT: { morning: 0, evening: 0 },
    CORPORATE_BATCH: { morning: 0, evening: 0 },
    NET: { morning: 0, evening: 0 },
  },
  sidearmPricing: {
    ASTRO: { morning: { single: 700, consecutive: 1200 }, evening: { single: 900, consecutive: 1600 } },
    CEMENT: { morning: { single: 650, consecutive: 1100 }, evening: { single: 850, consecutive: 1500 } },
  },
  netPricing: {
    ASTRO: { morning: { single: 400, consecutive: 700 }, evening: { single: 500, consecutive: 900 } },
  },
  coachingPricing: {
    ASTRO: { morning: { single: 1000, consecutive: 1800 }, evening: { single: 1200, consecutive: 2200 } },
  },
  fullCourtRate: { morning: { single: 2400, consecutive: 4400 }, evening: { single: 3200, consecutive: 6000 } },
};

describe('representativeCategoryBase — per-pitch-priced categories', () => {
  it('surfaces a positive base for SIDEARM from per-pitch rates (was 0 → skipped)', () => {
    // morning: max(700, 650) = 700
    expect(representativeCategoryBase('SIDEARM', perPitchOnly, 'morning')).toBe(700);
    expect(representativeCategoryBase('SIDEARM', perPitchOnly, 'evening')).toBe(900);
  });

  it('surfaces a positive base for NET', () => {
    expect(representativeCategoryBase('NET', perPitchOnly, 'morning')).toBe(400);
  });

  it('surfaces a positive base for COACHING', () => {
    expect(representativeCategoryBase('COACHING', perPitchOnly, 'morning')).toBe(1000);
  });

  it('surfaces a positive base for FULL_COURT from its pair rate', () => {
    expect(representativeCategoryBase('FULL_COURT', perPitchOnly, 'morning')).toBe(2400);
  });

  it('prefers a positive categoryRates default when present', () => {
    expect(representativeCategoryBase('MACHINE', perPitchOnly, 'morning')).toBe(600);
  });

  it('returns 0 only when nothing is configured anywhere', () => {
    const empty: ResourcePricingConfig = {
      categoryRates: {
        MACHINE: { morning: 0, evening: 0 },
        SIDEARM: { morning: 0, evening: 0 },
        COACHING: { morning: 0, evening: 0 },
        FULL_COURT: { morning: 0, evening: 0 },
        CORPORATE_BATCH: { morning: 0, evening: 0 },
        NET: { morning: 0, evening: 0 },
      },
    };
    expect(representativeCategoryBase('SIDEARM', empty, 'morning')).toBe(0);
  });
});
