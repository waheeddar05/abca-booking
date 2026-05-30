import { describe, it, expect, vi } from 'vitest';

// Mock Prisma client to avoid PrismaClientInitializationError in test env
vi.mock('@/lib/prisma', () => ({
  prisma: {},
}));

import {
  parseTimeString,
  timeToMinutes,
  getTimeSlab,
  getSlotPrice,
  getConsecutivePrice,
  calculateNewPricing,
  normalizePricingConfig,
  DEFAULT_PRICING_CONFIG,
  DEFAULT_TIME_SLABS,
} from '../pricing';

describe('parseTimeString', () => {
  it('parses HH:MM correctly', () => {
    expect(parseTimeString('07:30')).toEqual({ hours: 7, minutes: 30 });
    expect(parseTimeString('22:00')).toEqual({ hours: 22, minutes: 0 });
    expect(parseTimeString('00:00')).toEqual({ hours: 0, minutes: 0 });
  });

  it('handles single digit hours', () => {
    expect(parseTimeString('9:15')).toEqual({ hours: 9, minutes: 15 });
  });
});

describe('timeToMinutes', () => {
  it('converts time string to total minutes', () => {
    expect(timeToMinutes('00:00')).toBe(0);
    expect(timeToMinutes('01:00')).toBe(60);
    expect(timeToMinutes('07:30')).toBe(450);
    expect(timeToMinutes('22:30')).toBe(1350);
  });
});

describe('getTimeSlab', () => {
  const timeSlabs = DEFAULT_TIME_SLABS;

  it('returns morning for slots between 07:00-17:00 IST', () => {
    // 07:00 IST = 01:30 UTC
    const morningSlot = new Date('2026-01-15T01:30:00.000Z');
    expect(getTimeSlab(morningSlot, timeSlabs)).toBe('morning');
  });

  it('returns evening for slots at or after 19:00 IST', () => {
    // 19:00 IST = 13:30 UTC
    const eveningSlot = new Date('2026-01-15T13:30:00.000Z');
    expect(getTimeSlab(eveningSlot, timeSlabs)).toBe('evening');
  });

  it('returns evening for slots at the morning/evening boundary (no gap in default)', () => {
    // 17:30 IST = 12:00 UTC. Default slabs are now continuous
    // (morning 07:00–17:00 → evening 17:00–22:30), so 17:30 sits
    // inside the evening slab. Older defaults left a 17:00–19:00
    // gap which fell through to morning; that gap is gone.
    const eveningSlot = new Date('2026-01-15T12:00:00.000Z');
    expect(getTimeSlab(eveningSlot, timeSlabs)).toBe('evening');
  });

  it('accepts ISO string input', () => {
    expect(getTimeSlab('2026-01-15T01:30:00.000Z', timeSlabs)).toBe('morning');
  });
});

describe('getSlotPrice', () => {
  const pc = DEFAULT_PRICING_CONFIG;

  it('returns correct leather morning price', () => {
    const price = getSlotPrice('MACHINE', 'LEATHER', 'ASTRO', 'morning', pc);
    expect(price).toBe(600);
  });

  it('returns correct leather evening price', () => {
    const price = getSlotPrice('MACHINE', 'LEATHER', 'ASTRO', 'evening', pc);
    expect(price).toBe(700);
  });

  it('returns correct tennis morning price', () => {
    const price = getSlotPrice('TENNIS', 'TENNIS', 'ASTRO', 'morning', pc);
    expect(price).toBe(500);
  });

  it('returns correct tennis cement price', () => {
    const price = getSlotPrice('TENNIS', 'TENNIS', 'CEMENT', 'morning', pc);
    expect(price).toBe(550);
  });

  it('returns yantra price for YANTRA machine', () => {
    const price = getSlotPrice('MACHINE', 'LEATHER', 'ASTRO', 'morning', pc, 'YANTRA');
    expect(price).toBe(700);
  });

  it('handles TURF as CEMENT', () => {
    const turfPrice = getSlotPrice('TENNIS', 'TENNIS', 'TURF', 'morning', pc);
    const cementPrice = getSlotPrice('TENNIS', 'TENNIS', 'CEMENT', 'morning', pc);
    expect(turfPrice).toBe(cementPrice);
  });

  it('falls back to ASTRO for invalid pitch type', () => {
    const price = getSlotPrice('TENNIS', 'TENNIS', 'INVALID', 'morning', pc);
    const astroPrice = getSlotPrice('TENNIS', 'TENNIS', 'ASTRO', 'morning', pc);
    expect(price).toBe(astroPrice);
  });

  it('handles null pitch type', () => {
    const price = getSlotPrice('TENNIS', 'TENNIS', null, 'morning', pc);
    expect(price).toBe(500); // ASTRO morning
  });
});

describe('getConsecutivePrice', () => {
  const pc = DEFAULT_PRICING_CONFIG;

  it('returns correct consecutive leather morning price', () => {
    const price = getConsecutivePrice('MACHINE', 'LEATHER', 'ASTRO', 'morning', pc);
    expect(price).toBe(1000);
  });

  it('returns correct consecutive tennis evening price', () => {
    const price = getConsecutivePrice('TENNIS', 'TENNIS', 'ASTRO', 'evening', pc);
    expect(price).toBe(1000);
  });

  it('consecutive price is less than 2x single price', () => {
    const single = getSlotPrice('MACHINE', 'LEATHER', 'ASTRO', 'morning', pc);
    const consecutive = getConsecutivePrice('MACHINE', 'LEATHER', 'ASTRO', 'morning', pc);
    expect(consecutive).toBeLessThan(single * 2);
  });
});

describe('calculateNewPricing', () => {
  const pc = DEFAULT_PRICING_CONFIG;
  const ts = DEFAULT_TIME_SLABS;

  it('returns single price for non-consecutive slots', () => {
    const slots = [
      { startTime: new Date('2026-01-15T01:30:00.000Z'), endTime: new Date('2026-01-15T02:00:00.000Z') },
      { startTime: new Date('2026-01-15T03:30:00.000Z'), endTime: new Date('2026-01-15T04:00:00.000Z') },
    ];

    const result = calculateNewPricing(slots, 'MACHINE', 'LEATHER', 'ASTRO', ts, pc);
    expect(result).toHaveLength(2);
    result.forEach(r => {
      expect(r.discountAmount).toBe(0);
      expect(r.price).toBe(r.originalPrice);
    });
  });

  it('returns discounted price for consecutive slots', () => {
    const slots = [
      { startTime: new Date('2026-01-15T01:30:00.000Z'), endTime: new Date('2026-01-15T02:00:00.000Z') },
      { startTime: new Date('2026-01-15T02:00:00.000Z'), endTime: new Date('2026-01-15T02:30:00.000Z') },
    ];

    const result = calculateNewPricing(slots, 'MACHINE', 'LEATHER', 'ASTRO', ts, pc);
    expect(result).toHaveLength(2);

    const totalPrice = result.reduce((sum, r) => sum + r.price, 0);
    const totalOriginal = result.reduce((sum, r) => sum + r.originalPrice, 0);
    expect(totalPrice).toBeLessThan(totalOriginal);
    expect(result[0].discountAmount).toBeGreaterThan(0);
  });

  it('handles single slot correctly', () => {
    const slots = [
      { startTime: new Date('2026-01-15T01:30:00.000Z'), endTime: new Date('2026-01-15T02:00:00.000Z') },
    ];

    const result = calculateNewPricing(slots, 'MACHINE', 'LEATHER', 'ASTRO', ts, pc);
    expect(result).toHaveLength(1);
    expect(result[0].discountAmount).toBe(0);
    expect(result[0].price).toBe(600);
  });

  it('sorts slots by start time', () => {
    const slots = [
      { startTime: new Date('2026-01-15T02:00:00.000Z'), endTime: new Date('2026-01-15T02:30:00.000Z') },
      { startTime: new Date('2026-01-15T01:30:00.000Z'), endTime: new Date('2026-01-15T02:00:00.000Z') },
    ];

    const result = calculateNewPricing(slots, 'MACHINE', 'LEATHER', 'ASTRO', ts, pc);
    expect(result[0].startTime.getTime()).toBeLessThan(result[1].startTime.getTime());
  });

  it('applies consecutive rate per slot for 3+ consecutive slots', () => {
    const slots = [
      { startTime: new Date('2026-01-15T01:30:00.000Z'), endTime: new Date('2026-01-15T02:00:00.000Z') },
      { startTime: new Date('2026-01-15T02:00:00.000Z'), endTime: new Date('2026-01-15T02:30:00.000Z') },
      { startTime: new Date('2026-01-15T02:30:00.000Z'), endTime: new Date('2026-01-15T03:00:00.000Z') },
    ];

    const result = calculateNewPricing(slots, 'MACHINE', 'LEATHER', 'ASTRO', ts, pc);
    const consecutiveTotalFor2 = getConsecutivePrice('MACHINE', 'LEATHER', 'ASTRO', 'morning', pc);
    result.forEach(r => {
      expect(r.price).toBe(consecutiveTotalFor2 / 2);
      expect(r.discountAmount).toBeGreaterThan(0);
    });
  });

  it('only discounts the consecutive pair when mixed with a standalone slot', () => {
    const slots = [
      { startTime: new Date('2026-01-15T01:30:00.000Z'), endTime: new Date('2026-01-15T02:00:00.000Z') },
      { startTime: new Date('2026-01-15T02:00:00.000Z'), endTime: new Date('2026-01-15T02:30:00.000Z') },
      { startTime: new Date('2026-01-15T04:00:00.000Z'), endTime: new Date('2026-01-15T04:30:00.000Z') },
    ];

    const result = calculateNewPricing(slots, 'MACHINE', 'LEATHER', 'ASTRO', ts, pc);
    expect(result[0].discountAmount).toBeGreaterThan(0);
    expect(result[1].discountAmount).toBeGreaterThan(0);
    expect(result[2].discountAmount).toBe(0);
    expect(result[2].price).toBe(result[2].originalPrice);
  });

  it('discounts each consecutive pair independently when there are two separate pairs', () => {
    const slots = [
      { startTime: new Date('2026-01-15T01:30:00.000Z'), endTime: new Date('2026-01-15T02:00:00.000Z') },
      { startTime: new Date('2026-01-15T02:00:00.000Z'), endTime: new Date('2026-01-15T02:30:00.000Z') },
      { startTime: new Date('2026-01-15T05:00:00.000Z'), endTime: new Date('2026-01-15T05:30:00.000Z') },
      { startTime: new Date('2026-01-15T05:30:00.000Z'), endTime: new Date('2026-01-15T06:00:00.000Z') },
    ];

    const result = calculateNewPricing(slots, 'MACHINE', 'LEATHER', 'ASTRO', ts, pc);
    result.forEach(r => {
      expect(r.discountAmount).toBeGreaterThan(0);
    });
  });

  // Simulates the cancel-route behaviour: when one slot of a consecutive pair
  // is cancelled, repricing the remaining sibling must return to the single
  // rate so that the refund claw-back math (refund = paidPrice - sibling
  // price increase) keeps the user whole.
  it('reprices remaining slot to single rate when its pair is removed (cancellation scenario)', () => {
    const pairedSlots = [
      { startTime: new Date('2026-01-15T01:30:00.000Z'), endTime: new Date('2026-01-15T02:00:00.000Z') },
      { startTime: new Date('2026-01-15T02:00:00.000Z'), endTime: new Date('2026-01-15T02:30:00.000Z') },
    ];
    const initial = calculateNewPricing(pairedSlots, 'MACHINE', 'LEATHER', 'ASTRO', ts, pc);
    const paidPerSlot = initial[0].price;
    const totalPaid = initial[0].price + initial[1].price;

    // Cancel the first slot — recompute on only the remaining sibling
    const remaining = [pairedSlots[1]];
    const reprice = calculateNewPricing(remaining, 'MACHINE', 'LEATHER', 'ASTRO', ts, pc);
    const singleRate = getSlotPrice('MACHINE', 'LEATHER', 'ASTRO', 'morning', pc);

    expect(reprice).toHaveLength(1);
    expect(reprice[0].price).toBe(singleRate);
    expect(reprice[0].discountAmount).toBe(0);

    const siblingIncrease = reprice[0].price - paidPerSlot;
    const refundToUser = paidPerSlot - siblingIncrease;
    // Refund + new sibling price must equal what the user originally paid.
    expect(refundToUser + reprice[0].price).toBe(totalPaid);
  });
});

describe('normalizePricingConfig', () => {
  it('passes through new format configs', () => {
    const config = { ...DEFAULT_PRICING_CONFIG };
    const result = normalizePricingConfig(config);
    expect(result.leather).toBeDefined();
    expect(result.yantra).toBeDefined();
    expect(result.machine).toBeDefined();
    expect(result.tennis).toBeDefined();
  });

  it('auto-populates yantra from leather if missing', () => {
    const config = {
      leather: DEFAULT_PRICING_CONFIG.leather,
      machine: DEFAULT_PRICING_CONFIG.machine,
      tennis: DEFAULT_PRICING_CONFIG.tennis,
    };
    const result = normalizePricingConfig(config);
    expect(result.yantra).toBeDefined();
    expect(result.yantra.ASTRO.morning.single).toBe(result.leather.ASTRO.morning.single);
  });

  it('handles old format migration', () => {
    const oldConfig = {
      leatherMachine: {
        leather: { morning: { single: 700, consecutive: 1200 }, evening: { single: 800, consecutive: 1400 } },
        machine: { morning: { single: 500, consecutive: 800 }, evening: { single: 600, consecutive: 1000 } },
      },
      tennisMachine: { morning: { single: 400, consecutive: 700 }, evening: { single: 500, consecutive: 900 } },
    };

    const result = normalizePricingConfig(oldConfig);
    expect(result.leather).toBeDefined();
    expect(result.machine).toBeDefined();
    expect(result.tennis).toBeDefined();
    expect(result.tennis.ASTRO.morning.single).toBe(400);
  });

  it('fills missing pitch types with defaults', () => {
    const partialConfig = {
      leather: { ASTRO: DEFAULT_PRICING_CONFIG.leather.ASTRO },
      machine: DEFAULT_PRICING_CONFIG.machine,
      tennis: DEFAULT_PRICING_CONFIG.tennis,
    };
    const result = normalizePricingConfig(partialConfig);
    expect(result.leather.CEMENT).toBeDefined();
    expect(result.leather.NATURAL).toBeDefined();
  });
});
