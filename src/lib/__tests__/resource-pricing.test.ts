import { describe, it, expect, vi } from 'vitest';

// Mock Prisma so importing the policy/pricing chain doesn't try to
// connect to a database in the test environment.
vi.mock('@/lib/prisma', () => ({
  prisma: {},
}));

import {
  getResourceSlotPrice,
  type ResourcePricingConfig,
} from '../resource-pricing';
import { DEFAULT_TIME_SLABS } from '../pricing';

/**
 * Regression coverage for the coaching price discrepancy:
 * the booking page priced four back-to-back Personal Coaching slots off
 * the selected pitch (coachingPricing[pitch] → consecutive pair → ₹450
 * each, ₹1800 total) but the booking endpoint stored ₹1000 each (₹4000)
 * because the client dropped pitchType from the COACHING payload, so the
 * server fell back to the flat categoryRates.COACHING default.
 *
 * These tests pin the engine behaviour the client fix relies on:
 * pricing is identical on both sides ONLY when the same pitchType reaches
 * the server.
 */

// A morning instant in IST (08:00 IST → morning slab under DEFAULT_TIME_SLABS).
const MORNING = new Date('2026-06-12T08:00:00+05:30');

// Mirrors how an admin configures Personal Coaching in the editor: a
// per-pitch {single, consecutive} pair plus the flat legacy category
// default. `consecutive` is the TOTAL for a 2-slot pair, so per-slot in
// a chain is consecutive / 2 = 450.
const CONFIG: ResourcePricingConfig = {
  categoryRates: {
    MACHINE:         { morning: 600, evening: 800 },
    SIDEARM:         { morning: 700, evening: 900 },
    COACHING:        { morning: 1000, evening: 1200 },
    FULL_COURT:      { morning: 2400, evening: 3200 },
    CORPORATE_BATCH: { morning: 1500, evening: 1800 },
    NET:             { morning: 400, evening: 500 },
  },
  coachingPricing: {
    ASTRO: {
      morning: { single: 1000, consecutive: 900 },
      evening: { single: 1200, consecutive: 1100 },
    },
  },
};

describe('getResourceSlotPrice — COACHING consecutive pricing', () => {
  it('uses the per-pitch consecutive pair when pitchType is supplied', async () => {
    const price = await getResourceSlotPrice({
      category: 'COACHING',
      pitchType: 'ASTRO',
      isConsecutive: true,
      startTime: MORNING,
      pricingConfig: CONFIG,
      timeSlabConfig: DEFAULT_TIME_SLABS,
    });
    expect(price).toBe(450); // 900 / 2
  });

  it('uses the per-pitch single rate for a standalone coaching slot', async () => {
    const price = await getResourceSlotPrice({
      category: 'COACHING',
      pitchType: 'ASTRO',
      isConsecutive: false,
      startTime: MORNING,
      pricingConfig: CONFIG,
      timeSlabConfig: DEFAULT_TIME_SLABS,
    });
    expect(price).toBe(1000);
  });

  it('reproduces the bug: WITHOUT pitchType it falls back to the flat category default', async () => {
    // This is exactly what the server saw when the client stripped
    // pitchType from the COACHING payload — the consecutive discount is
    // silently lost and every slot is billed at the flat ₹1000 default.
    const price = await getResourceSlotPrice({
      category: 'COACHING',
      pitchType: null,
      isConsecutive: true,
      startTime: MORNING,
      pricingConfig: CONFIG,
      timeSlabConfig: DEFAULT_TIME_SLABS,
    });
    expect(price).toBe(1000); // categoryRates.COACHING.morning — the wrong number
  });

  it('four back-to-back slots total ₹1800 with pitchType, ₹4000 without (the reported bug)', async () => {
    const withPitch = await getResourceSlotPrice({
      category: 'COACHING', pitchType: 'ASTRO', isConsecutive: true,
      startTime: MORNING, pricingConfig: CONFIG, timeSlabConfig: DEFAULT_TIME_SLABS,
    });
    const withoutPitch = await getResourceSlotPrice({
      category: 'COACHING', pitchType: null, isConsecutive: true,
      startTime: MORNING, pricingConfig: CONFIG, timeSlabConfig: DEFAULT_TIME_SLABS,
    });
    expect(withPitch * 4).toBe(1800);   // what the user saw + paid
    expect(withoutPitch * 4).toBe(4000); // what the booking wrongly stored
  });
});
