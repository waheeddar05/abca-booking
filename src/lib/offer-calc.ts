/**
 * Offer calculation — canonical discount order of operations.
 *
 * Booking a chain of consecutive slots involves TWO kinds of discount:
 *
 *   1. Multi-slot (consecutive) pricing from the Machine Configuration
 *      section. This is the effective per-slot price for a back-to-back
 *      pair (e.g. two 30-min slots at ₹900 instead of ₹1000 → ₹450/slot).
 *      It is baked into the `base` passed in here.
 *   2. Recurring + Promotional offers (Admin → Offers).
 *
 * The correct order (see the product spec) is:
 *   base price → apply multi-slot pricing → THEN apply recurring / promo
 *   on the multi-slot-adjusted amount.
 *
 * i.e. the offer must be computed on the *effective* booking price, not on
 * the pre-multi-slot single-slot price. Applying a percentage offer to the
 * single-slot price and then subtracting it from the (lower) multi-slot
 * price over-discounts the booking.
 *
 * This module is intentionally free of any Prisma / server imports so it
 * can run in the browser (the slot picker computes the amount it charges)
 * AND on the server (the availability preview + booking route) from the
 * same code path — guaranteeing the amount the user is shown/charged
 * equals the price the booking is recorded at.
 */

export interface OfferDescriptor {
  name: string;
  discountType: 'PERCENTAGE' | 'FIXED';
  /** Percentage (0-100) when PERCENTAGE, flat ₹ when FIXED. */
  discountValue: number;
}

export interface SlotDiscountInput {
  /**
   * Per-slot price AFTER multi-slot (consecutive) pricing has already
   * been applied — i.e. the effective booking price for this slot.
   */
  base: number;
  /** Recurring ₹ discount for a single (non-consecutive) slot. */
  recurringOneSlot: number;
  /** Recurring ₹ discount for a slot inside a back-to-back chain. */
  recurringTwoSlot: number;
  /** Whether this slot sits in a chain of consecutive slots. */
  isConsecutive: boolean;
  /**
   * Applicable promotional offers, already filtered by
   * day / time / audience / category / machine. The best (largest ₹)
   * offer is applied on the post-recurring amount.
   */
  offers: OfferDescriptor[];
}

export interface SlotDiscountResult {
  /** Recurring ₹ off (capped at base). Applied first. */
  recurring: number;
  /** Promotional ₹ off, computed on (base − recurring). */
  promo: number;
  /** Name of the winning promotional offer, if any. */
  promoName: string | null;
  /** recurring + promo. */
  total: number;
  /** base − total, never below 0. The amount actually payable per slot. */
  final: number;
}

/**
 * Compute the recurring + promotional discount for one slot, given a base
 * price that has ALREADY had multi-slot pricing applied.
 *
 *   1. Recurring slot discount (a flat ₹ from the Machine Configuration /
 *      Offers section, capped at the base) comes off first.
 *   2. The single best promotional offer is then computed on the REMAINING
 *      amount, so a percentage offer is charged against the
 *      post-multi-slot, post-recurring price.
 *
 * Mirrors the server-side sequence in /api/slots/book-resource so the
 * client and server always agree on the payable amount.
 */
export function computeSlotDiscount(input: SlotDiscountInput): SlotDiscountResult {
  const base = Math.max(0, input.base);
  if (base <= 0) {
    return { recurring: 0, promo: 0, promoName: null, total: 0, final: 0 };
  }

  const recurringRaw = input.isConsecutive ? input.recurringTwoSlot : input.recurringOneSlot;
  const recurring = Math.min(Math.max(0, recurringRaw), base);
  const remaining = base - recurring;

  let promo = 0;
  let promoName: string | null = null;
  if (remaining > 0) {
    for (const offer of input.offers) {
      const d =
        offer.discountType === 'PERCENTAGE'
          ? Math.min(remaining, Math.floor((remaining * offer.discountValue) / 100))
          : Math.min(remaining, Math.floor(offer.discountValue));
      if (d > promo) {
        promo = d;
        promoName = offer.name;
      }
    }
  }

  const total = recurring + promo;
  return { recurring, promo, promoName, total, final: Math.max(0, base - total) };
}
