import { describe, it, expect } from 'vitest';
import { computeSlotDiscount, type OfferDescriptor } from '@/lib/offer-calc';

const promo10: OfferDescriptor = { name: '10% Off', discountType: 'PERCENTAGE', discountValue: 10 };
const promoFlat100: OfferDescriptor = { name: 'Flat ₹100', discountType: 'FIXED', discountValue: 100 };

describe('computeSlotDiscount — multi-slot pricing applied before offers', () => {
  // The canonical example from the spec:
  //   1 slot = ₹500, two-slot configured price = ₹900 (→ ₹450/slot),
  //   promo = 10%.  The 10% must land on the multi-slot-adjusted ₹450,
  //   NOT the pre-multi-slot ₹500.
  //   Per slot: 450 − floor(450 * 10%) = 450 − 45 = 405.
  //   Two slots: 810.
  it('applies a percentage promo to the consecutive (multi-slot) price', () => {
    const r = computeSlotDiscount({
      base: 450, // consecutive per-slot price (900 / 2)
      recurringOneSlot: 0,
      recurringTwoSlot: 0,
      isConsecutive: true,
      offers: [promo10],
    });
    expect(r.promo).toBe(45);
    expect(r.final).toBe(405);
    expect(r.total).toBe(45);
    expect(r.promoName).toBe('10% Off');
    // Two identical consecutive slots → ₹810 payable.
    expect(r.final * 2).toBe(810);
  });

  it('a percentage promo on a single slot uses the single price', () => {
    const r = computeSlotDiscount({
      base: 500,
      recurringOneSlot: 0,
      recurringTwoSlot: 0,
      isConsecutive: false,
      offers: [promo10],
    });
    expect(r.promo).toBe(50);
    expect(r.final).toBe(450);
  });

  it('recurring discount comes off first, promo lands on the remainder', () => {
    // base 450, recurring ₹50 (two-slot), then 10% of (450 - 50 = 400) = 40.
    const r = computeSlotDiscount({
      base: 450,
      recurringOneSlot: 30,
      recurringTwoSlot: 50,
      isConsecutive: true,
      offers: [promo10],
    });
    expect(r.recurring).toBe(50);
    expect(r.promo).toBe(40);
    expect(r.total).toBe(90);
    expect(r.final).toBe(360);
  });

  it('picks the single best promotional offer by absolute ₹', () => {
    // On a ₹450 base: 10% = 45, flat ₹100 = 100 → flat wins.
    const r = computeSlotDiscount({
      base: 450,
      recurringOneSlot: 0,
      recurringTwoSlot: 0,
      isConsecutive: true,
      offers: [promo10, promoFlat100],
    });
    expect(r.promo).toBe(100);
    expect(r.promoName).toBe('Flat ₹100');
    expect(r.final).toBe(350);
  });

  it('caps recurring at the base and never goes negative', () => {
    const r = computeSlotDiscount({
      base: 40,
      recurringOneSlot: 0,
      recurringTwoSlot: 100, // larger than base
      isConsecutive: true,
      offers: [promo10],
    });
    expect(r.recurring).toBe(40);
    expect(r.promo).toBe(0); // nothing left for the promo
    expect(r.final).toBe(0);
  });

  it('caps a fixed promo at the remaining amount', () => {
    const r = computeSlotDiscount({
      base: 60,
      recurringOneSlot: 0,
      recurringTwoSlot: 0,
      isConsecutive: false,
      offers: [promoFlat100], // ₹100 flat on a ₹60 slot
    });
    expect(r.promo).toBe(60);
    expect(r.final).toBe(0);
  });

  it('returns no discount when there are no offers or recurring rules', () => {
    const r = computeSlotDiscount({
      base: 500,
      recurringOneSlot: 0,
      recurringTwoSlot: 0,
      isConsecutive: false,
      offers: [],
    });
    expect(r.total).toBe(0);
    expect(r.final).toBe(500);
    expect(r.promoName).toBeNull();
  });

  it('handles a zero base gracefully', () => {
    const r = computeSlotDiscount({
      base: 0,
      recurringOneSlot: 100,
      recurringTwoSlot: 100,
      isConsecutive: true,
      offers: [promo10],
    });
    expect(r).toEqual({ recurring: 0, promo: 0, promoName: null, total: 0, final: 0 });
  });
});
