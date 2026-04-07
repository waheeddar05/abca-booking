import { prisma } from '@/lib/prisma';

/**
 * Get the special user discount for a given user.
 * Returns null if user is not special or has no discount configured.
 */
export async function getSpecialUserDiscount(
  userId: string,
): Promise<{ discountType: 'PERCENTAGE' | 'FIXED'; discountValue: number } | null> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        isSpecialUser: true,
        specialDiscountType: true,
        specialDiscountValue: true,
      },
    });

    if (!user) {
      return null;
    }

    // Return discount only if user is special and both type and value are set
    if (user.isSpecialUser && user.specialDiscountType && user.specialDiscountValue !== null) {
      return {
        discountType: user.specialDiscountType,
        discountValue: user.specialDiscountValue,
      };
    }

    return null;
  } catch (error) {
    console.error('Error fetching special user discount:', error);
    return null;
  }
}

/**
 * Calculate discount amounts, supporting special-user offer stacking.
 *
 * Business rules:
 * - Offers with appliesTo="SPECIAL" stack additively with other offers (they don't compete).
 * - Among non-special offers (appliesTo="ALL"), the highest discount wins.
 * - A special user gets: best "ALL" offer + all applicable "SPECIAL" offers.
 * - A regular user gets: only the best "ALL" offer.
 */
export interface DiscountResult {
  totalDiscount: number;
  label: string;
  breakdown: { source: string; amount: number }[];
}

export function calculateStackedDiscount(
  slotPrice: number,
  promoDiscount: {
    discountType: 'PERCENTAGE' | 'FIXED';
    discountValue: number;
    name: string;
    appliesTo: string;
  } | null,
  allPromoDiscounts: {
    discountType: 'PERCENTAGE' | 'FIXED';
    discountValue: number;
    name: string;
    appliesTo: string;
  }[],
  isSpecialUser: boolean,
): DiscountResult | null {
  const breakdown: { source: string; amount: number }[] = [];
  let runningPrice = slotPrice;

  // 1. Find the best "ALL" offer among all applicable promos
  const allUserOffers = allPromoDiscounts.filter(o => o.appliesTo === 'ALL');
  let bestAllOffer: typeof allUserOffers[0] | null = null;
  let bestAllAmount = 0;
  for (const offer of allUserOffers) {
    const amount = offer.discountType === 'PERCENTAGE'
      ? (slotPrice * offer.discountValue) / 100
      : offer.discountValue;
    if (amount > bestAllAmount) {
      bestAllAmount = amount;
      bestAllOffer = offer;
    }
  }

  // Apply the best ALL offer
  if (bestAllOffer && bestAllAmount > 0) {
    const reduction = Math.min(bestAllAmount, runningPrice);
    runningPrice -= reduction;
    breakdown.push({ source: bestAllOffer.name, amount: reduction });
  }

  // 2. If user is special, stack all SPECIAL-only offers on top
  if (isSpecialUser) {
    const specialOffers = allPromoDiscounts.filter(o => o.appliesTo === 'SPECIAL');
    for (const offer of specialOffers) {
      if (runningPrice <= 0) break;
      const amount = offer.discountType === 'PERCENTAGE'
        ? (slotPrice * offer.discountValue) / 100
        : offer.discountValue;
      const reduction = Math.min(amount, runningPrice);
      if (reduction > 0) {
        runningPrice -= reduction;
        breakdown.push({ source: offer.name, amount: reduction });
      }
    }
  }

  if (breakdown.length === 0) {
    return null;
  }

  const totalDiscount = breakdown.reduce((sum, b) => sum + b.amount, 0);
  const label = breakdown.map(b => b.source).join(' + ');

  return { totalDiscount, label, breakdown };
}

/**
 * Legacy: Calculate the best discount between promotional offer and special user discount.
 * Kept for backward compatibility. New code should use calculateStackedDiscount.
 */
export function getBestDiscount(
  slotPrice: number,
  promoDiscount: { discountType: 'PERCENTAGE' | 'FIXED'; discountValue: number; name: string } | null,
  specialDiscount: { discountType: 'PERCENTAGE' | 'FIXED'; discountValue: number } | null,
): {
  source: 'promo' | 'special' | null;
  discountType: 'PERCENTAGE' | 'FIXED';
  discountAmount: number;
  label: string;
} | null {
  // Calculate absolute ₹ amounts
  const promoAmount = promoDiscount
    ? promoDiscount.discountType === 'PERCENTAGE'
      ? (slotPrice * promoDiscount.discountValue) / 100
      : promoDiscount.discountValue
    : 0;

  const specialAmount = specialDiscount
    ? specialDiscount.discountType === 'PERCENTAGE'
      ? (slotPrice * specialDiscount.discountValue) / 100
      : specialDiscount.discountValue
    : 0;

  // No discounts available
  if (promoAmount === 0 && specialAmount === 0) {
    return null;
  }

  // Special discount is higher
  if (specialAmount > promoAmount) {
    return {
      source: 'special',
      discountType: specialDiscount!.discountType,
      discountAmount: specialAmount,
      label: 'Special User Discount',
    };
  }

  // Promo discount is higher (or equal)
  if (promoAmount > 0) {
    return {
      source: 'promo',
      discountType: promoDiscount!.discountType,
      discountAmount: promoAmount,
      label: promoDiscount!.name,
    };
  }

  return null;
}
