import { prisma } from '@/lib/prisma';

export interface DiscountConfig {
  enabled: boolean;
  minSlots: number;
  discountType: 'PERCENTAGE' | 'FIXED';
  discountValue: number;
  defaultSlotPrice: number;
}

export async function getDiscountConfig(): Promise<DiscountConfig> {
  const policies = await prisma.policy.findMany({
    where: {
      key: {
        in: [
          'CONSECUTIVE_DISCOUNT_ENABLED',
          'CONSECUTIVE_DISCOUNT_MIN_SLOTS',
          'CONSECUTIVE_DISCOUNT_TYPE',
          'CONSECUTIVE_DISCOUNT_VALUE',
          'DEFAULT_SLOT_PRICE',
        ],
      },
    },
  });

  const config: Record<string, string> = {};
  for (const p of policies) {
    config[p.key] = p.value;
  }

  return {
    enabled: config['CONSECUTIVE_DISCOUNT_ENABLED'] === 'true',
    minSlots: parseInt(config['CONSECUTIVE_DISCOUNT_MIN_SLOTS'] || '2'),
    discountType: (config['CONSECUTIVE_DISCOUNT_TYPE'] as 'PERCENTAGE' | 'FIXED') || 'PERCENTAGE',
    discountValue: parseFloat(config['CONSECUTIVE_DISCOUNT_VALUE'] || '0'),
    defaultSlotPrice: parseFloat(config['DEFAULT_SLOT_PRICE'] || '600'),
  };
}

export interface SlotWithPrice {
  startTime: Date;
  endTime: Date;
  price: number;
}

/**
 * Check if slots are strictly consecutive (each slot's endTime matches the next's startTime).
 */
export function areConsecutive(slots: SlotWithPrice[]): boolean {
  if (slots.length < 2) return false;
  const sorted = [...slots].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].endTime.getTime() !== sorted[i + 1].startTime.getTime()) {
      return false;
    }
  }
  return true;
}

/**
 * Calculate pricing for a set of booked slots, applying consecutive discount if eligible.
 */
export function calculatePricing(
  slots: SlotWithPrice[],
  discountConfig: DiscountConfig
): Array<{
  startTime: Date;
  endTime: Date;
  originalPrice: number;
  price: number;
  discountAmount: number;
  discountType: 'PERCENTAGE' | 'FIXED' | null;
}> {
  const sorted = [...slots].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  const consecutive = areConsecutive(sorted);
  const applyDiscount =
    discountConfig.enabled &&
    consecutive &&
    sorted.length >= discountConfig.minSlots &&
    discountConfig.discountValue > 0;

  return sorted.map(slot => {
    const originalPrice = slot.price;
    let discountAmount = 0;
    let discountType: 'PERCENTAGE' | 'FIXED' | null = null;

    if (applyDiscount) {
      discountType = discountConfig.discountType;
      if (discountConfig.discountType === 'PERCENTAGE') {
        discountAmount = Math.round((originalPrice * discountConfig.discountValue) / 100);
      } else {
        discountAmount = Math.min(discountConfig.discountValue, originalPrice);
      }
    }

    return {
      startTime: slot.startTime,
      endTime: slot.endTime,
      originalPrice,
      price: originalPrice - discountAmount,
      discountAmount,
      discountType,
    };
  });
}
