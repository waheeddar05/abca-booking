import { describe, it, expect } from 'vitest';
import {
  recurringRuleMatches,
  computeRecurringDiscountForSlot,
} from '@/lib/resource-discounts';
import type { RecurringSlotDiscount } from '@prisma/client';

/**
 * Regression guard for the "recurring offer only applies to bowling
 * machines" bug. An "all categories" recurring offer (empty `categories`,
 * empty `machineRowIds`) must match every booking category — not just
 * MACHINE. The machine-row gate must only narrow MACHINE bookings.
 */
const baseRule: RecurringSlotDiscount = {
  id: 'r1',
  centerId: 'c1',
  enabled: true,
  days: [0, 1, 2, 3, 4, 5, 6],
  slotStartTime: '08:00',
  slotEndTime: '09:00',
  machineIds: [],
  pitchTypes: [],
  machineRowIds: [],
  categories: [],
  oneSlotDiscount: 100,
  twoSlotDiscount: 100,
  appliesTo: 'ALL',
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as RecurringSlotDiscount;

// 2026-05-29 08:30 IST == 03:00 UTC — inside the rule's [08:00, 09:00) window.
const inWindow = new Date('2026-05-29T03:00:00.000Z');

const ALL_CATEGORIES = ['MACHINE', 'SIDEARM', 'COACHING', 'NET', 'FULL_COURT', 'CORPORATE_BATCH'] as const;

describe('recurringRuleMatches — all-categories offer', () => {
  for (const cat of ALL_CATEGORIES) {
    it(`applies to ${cat} when categories is empty`, () => {
      expect(
        recurringRuleMatches({ rule: baseRule, startTime: inWindow, category: cat, machineRowId: null }),
      ).toBe(true);
    });
  }

  it('respects an explicit category allow-list', () => {
    const rule = { ...baseRule, categories: ['SIDEARM', 'COACHING'] } as unknown as RecurringSlotDiscount;
    expect(recurringRuleMatches({ rule, startTime: inWindow, category: 'SIDEARM', machineRowId: null })).toBe(true);
    expect(recurringRuleMatches({ rule, startTime: inWindow, category: 'MACHINE', machineRowId: null })).toBe(false);
  });

  it('machine-row pin narrows MACHINE only — never blocks other categories', () => {
    const rule = { ...baseRule, machineRowIds: ['m1'] } as unknown as RecurringSlotDiscount;
    // Non-machine categories ignore the machine-row pin entirely.
    expect(recurringRuleMatches({ rule, startTime: inWindow, category: 'SIDEARM', machineRowId: null })).toBe(true);
    expect(recurringRuleMatches({ rule, startTime: inWindow, category: 'COACHING', machineRowId: null })).toBe(true);
    // MACHINE booking on a different/absent row is blocked.
    expect(recurringRuleMatches({ rule, startTime: inWindow, category: 'MACHINE', machineRowId: null })).toBe(false);
    expect(recurringRuleMatches({ rule, startTime: inWindow, category: 'MACHINE', machineRowId: 'm2' })).toBe(false);
    // MACHINE booking on the pinned row matches.
    expect(recurringRuleMatches({ rule, startTime: inWindow, category: 'MACHINE', machineRowId: 'm1' })).toBe(true);
  });

  it('does not match outside the time window', () => {
    const before = new Date('2026-05-29T02:00:00.000Z'); // 07:30 IST
    expect(recurringRuleMatches({ rule: baseRule, startTime: before, category: 'SIDEARM', machineRowId: null })).toBe(false);
  });
});

describe('computeRecurringDiscountForSlot', () => {
  it('returns the single-slot discount for a non-consecutive slot', () => {
    const s = computeRecurringDiscountForSlot({ matches: [baseRule], isConsecutive: false, isSpecialUser: false });
    expect(s.total).toBe(100);
    expect(s.label).toBe('Slot offer');
  });

  it('returns the two-slot discount for a consecutive slot', () => {
    const rule = { ...baseRule, oneSlotDiscount: 50, twoSlotDiscount: 100 } as unknown as RecurringSlotDiscount;
    const s = computeRecurringDiscountForSlot({ matches: [rule], isConsecutive: true, isSpecialUser: false });
    expect(s.total).toBe(100);
    expect(s.label).toBe('Consecutive offer');
  });
});
