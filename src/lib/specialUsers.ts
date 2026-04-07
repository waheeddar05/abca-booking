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
 * Calculate the best discount between promotional offer and special user discount.
 * "Higher discount wins" — compare the absolute ₹ amount each would give on the slot price.
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

  // This should not be reached, but handle it gracefully
  return null;
}
