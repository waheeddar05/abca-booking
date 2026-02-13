import { prisma } from '@/lib/prisma';

export interface SlabPricing {
  single: number;
  consecutive: number;
}

export interface PricingConfig {
  leatherMachine: {
    leather: {
      morning: SlabPricing;
      evening: SlabPricing;
    };
    machine: {
      morning: SlabPricing;
      evening: SlabPricing;
    };
  };
  tennisMachine: {
    morning: SlabPricing;
    evening: SlabPricing;
  };
  cementWicket: {
    morning: SlabPricing;
    evening: SlabPricing;
  };
}

export interface TimeSlabConfig {
  morning: { start: string; end: string };
  evening: { start: string; end: string };
}

export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  leatherMachine: {
    leather: {
      morning: { single: 600, consecutive: 1000 },
      evening: { single: 700, consecutive: 1200 },
    },
    machine: {
      morning: { single: 500, consecutive: 800 },
      evening: { single: 600, consecutive: 1000 },
    },
  },
  tennisMachine: {
    morning: { single: 500, consecutive: 800 },
    evening: { single: 600, consecutive: 1000 },
  },
  cementWicket: {
    morning: { single: 550, consecutive: 900 },
    evening: { single: 650, consecutive: 1100 },
  },
};

export const DEFAULT_TIME_SLABS: TimeSlabConfig = {
  morning: { start: '07:00', end: '17:00' },
  evening: { start: '19:00', end: '22:30' },
};

/**
 * Parse a time string "HH:MM" into { hours, minutes }.
 */
export function parseTimeString(timeStr: string): { hours: number; minutes: number } {
  const [h, m] = timeStr.split(':').map(Number);
  return { hours: h, minutes: m ?? 0 };
}

/**
 * Convert time string "HH:MM" to total minutes since midnight.
 */
export function timeToMinutes(timeStr: string): number {
  const { hours, minutes } = parseTimeString(timeStr);
  return hours * 60 + minutes;
}

/**
 * Determine whether a slot (by its start time ISO string) falls in morning or evening slab.
 */
export function getTimeSlab(
  slotStartTimeISO: string | Date,
  timeSlabs: TimeSlabConfig
): 'morning' | 'evening' {
  const date = typeof slotStartTimeISO === 'string' ? new Date(slotStartTimeISO) : slotStartTimeISO;
  // Get IST hours and minutes
  const istStr = date.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false, hour: '2-digit', minute: '2-digit' });
  const slotMinutes = timeToMinutes(istStr);

  const morningStart = timeToMinutes(timeSlabs.morning.start);
  const morningEnd = timeToMinutes(timeSlabs.morning.end);
  const eveningStart = timeToMinutes(timeSlabs.evening.start);

  if (slotMinutes >= morningStart && slotMinutes < morningEnd) {
    return 'morning';
  }
  if (slotMinutes >= eveningStart) {
    return 'evening';
  }
  // Default to morning if somehow in gap
  return 'morning';
}

/**
 * Get the single-slot price for a given configuration.
 * @param category - 'MACHINE' (leather machine) or 'TENNIS' (tennis machine)
 * @param ballType - 'LEATHER', 'MACHINE', or 'TENNIS'
 * @param pitchType - 'ASTRO' or 'TURF' (null for leather machine)
 * @param timeSlab - 'morning' or 'evening'
 * @param pricingConfig - the pricing config
 */
export function getSlotPrice(
  category: 'MACHINE' | 'TENNIS',
  ballType: string,
  pitchType: string | null,
  timeSlab: 'morning' | 'evening',
  pricingConfig: PricingConfig
): number {
  if (category === 'MACHINE') {
    const subType = ballType === 'LEATHER' ? 'leather' : 'machine';
    return pricingConfig.leatherMachine[subType][timeSlab].single;
  }
  // Tennis machine
  if (pitchType === 'TURF') {
    return pricingConfig.cementWicket[timeSlab].single;
  }
  return pricingConfig.tennisMachine[timeSlab].single;
}

/**
 * Get the consecutive (2-slot) total price for a given configuration.
 */
export function getConsecutivePrice(
  category: 'MACHINE' | 'TENNIS',
  ballType: string,
  pitchType: string | null,
  timeSlab: 'morning' | 'evening',
  pricingConfig: PricingConfig
): number {
  if (category === 'MACHINE') {
    const subType = ballType === 'LEATHER' ? 'leather' : 'machine';
    return pricingConfig.leatherMachine[subType][timeSlab].consecutive;
  }
  if (pitchType === 'TURF') {
    return pricingConfig.cementWicket[timeSlab].consecutive;
  }
  return pricingConfig.tennisMachine[timeSlab].consecutive;
}

/**
 * Fetch pricing config from database Policy table, falling back to defaults.
 */
export async function getPricingConfig(): Promise<PricingConfig> {
  try {
    const policy = await prisma.policy.findUnique({
      where: { key: 'PRICING_CONFIG' },
    });
    if (policy?.value) {
      return JSON.parse(policy.value) as PricingConfig;
    }
  } catch {
    // Fall back to default
  }
  return DEFAULT_PRICING_CONFIG;
}

/**
 * Fetch time slab config from database Policy table, falling back to defaults.
 */
export async function getTimeSlabConfig(): Promise<TimeSlabConfig> {
  try {
    const policy = await prisma.policy.findUnique({
      where: { key: 'TIME_SLAB_CONFIG' },
    });
    if (policy?.value) {
      return JSON.parse(policy.value) as TimeSlabConfig;
    }
  } catch {
    // Fall back to default
  }
  return DEFAULT_TIME_SLABS;
}

/**
 * Calculate pricing for booked slots with the new pricing model.
 * If 2+ consecutive slots, use consecutive rate per slot.
 */
export function calculateNewPricing(
  slots: Array<{ startTime: Date; endTime: Date }>,
  category: 'MACHINE' | 'TENNIS',
  ballType: string,
  pitchType: string | null,
  timeSlabs: TimeSlabConfig,
  pricingConfig: PricingConfig
): Array<{
  startTime: Date;
  endTime: Date;
  originalPrice: number;
  price: number;
  discountAmount: number;
}> {
  const sorted = [...slots].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

  // Check if consecutive
  const isConsecutive = sorted.length >= 2 && sorted.every((slot, i) => {
    if (i === 0) return true;
    return sorted[i - 1].endTime.getTime() === slot.startTime.getTime();
  });

  return sorted.map(slot => {
    const slab = getTimeSlab(slot.startTime, timeSlabs);
    const singlePrice = getSlotPrice(category, ballType, pitchType, slab, pricingConfig);
    const consecutiveTotalFor2 = getConsecutivePrice(category, ballType, pitchType, slab, pricingConfig);
    const consecutivePerSlot = consecutiveTotalFor2 / 2;

    const originalPrice = singlePrice;
    const price = isConsecutive ? consecutivePerSlot : singlePrice;
    const discountAmount = originalPrice - price;

    return {
      startTime: slot.startTime,
      endTime: slot.endTime,
      originalPrice,
      price,
      discountAmount,
    };
  });
}
