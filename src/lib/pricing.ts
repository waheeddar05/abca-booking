import { prisma } from '@/lib/prisma';

export interface SlabPricing {
  single: number;
  consecutive: number;
}

export interface PitchPricing {
  ASTRO: { morning: SlabPricing; evening: SlabPricing };
  CEMENT: { morning: SlabPricing; evening: SlabPricing };
  NATURAL: { morning: SlabPricing; evening: SlabPricing };
}

export interface PricingConfig {
  leather: PitchPricing;
  yantra: PitchPricing;
  machine: PitchPricing;
  yantra_machine: PitchPricing;
  tennis: PitchPricing;
}

export interface TimeSlabConfig {
  morning: { start: string; end: string };
  evening: { start: string; end: string };
}

export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  leather: {
    ASTRO: {
      morning: { single: 600, consecutive: 1000 },
      evening: { single: 700, consecutive: 1200 },
    },
    CEMENT: {
      morning: { single: 600, consecutive: 1000 },
      evening: { single: 700, consecutive: 1200 },
    },
    NATURAL: {
      morning: { single: 600, consecutive: 1000 },
      evening: { single: 700, consecutive: 1200 },
    },
  },
  yantra: {
    ASTRO: {
      morning: { single: 700, consecutive: 1200 },
      evening: { single: 800, consecutive: 1400 },
    },
    CEMENT: {
      morning: { single: 700, consecutive: 1200 },
      evening: { single: 800, consecutive: 1400 },
    },
    NATURAL: {
      morning: { single: 700, consecutive: 1200 },
      evening: { single: 800, consecutive: 1400 },
    },
  },
  machine: {
    ASTRO: {
      morning: { single: 500, consecutive: 800 },
      evening: { single: 600, consecutive: 1000 },
    },
    CEMENT: {
      morning: { single: 500, consecutive: 800 },
      evening: { single: 600, consecutive: 1000 },
    },
    NATURAL: {
      morning: { single: 500, consecutive: 800 },
      evening: { single: 600, consecutive: 1000 },
    },
  },
  yantra_machine: {
    ASTRO: {
      morning: { single: 600, consecutive: 1000 },
      evening: { single: 700, consecutive: 1200 },
    },
    CEMENT: {
      morning: { single: 600, consecutive: 1000 },
      evening: { single: 700, consecutive: 1200 },
    },
    NATURAL: {
      morning: { single: 600, consecutive: 1000 },
      evening: { single: 700, consecutive: 1200 },
    },
  },
  tennis: {
    ASTRO: {
      morning: { single: 500, consecutive: 800 },
      evening: { single: 600, consecutive: 1000 },
    },
    CEMENT: {
      morning: { single: 550, consecutive: 900 },
      evening: { single: 650, consecutive: 1100 },
    },
    NATURAL: {
      morning: { single: 550, consecutive: 900 },
      evening: { single: 650, consecutive: 1100 },
    },
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
 * Resolve pricing tier key from category, ballType, and machineId.
 */
function resolvePricingTier(
  category: 'MACHINE' | 'TENNIS',
  ballType: string,
  machineId?: string | null
): keyof PricingConfig {
  if (category === 'TENNIS') return 'tennis';
  // Yantra has its own premium pricing tiers
  if (machineId === 'YANTRA') {
    return ballType === 'LEATHER' ? 'yantra' : 'yantra_machine';
  }
  return ballType === 'LEATHER' ? 'leather' : 'machine';
}

/**
 * Get the single-slot price for a given configuration.
 * @param category - 'MACHINE' (leather machine) or 'TENNIS' (tennis machine)
 * @param ballType - 'LEATHER', 'MACHINE', or 'TENNIS'
 * @param pitchType - 'ASTRO' or 'TURF' (null for leather machine)
 * @param timeSlab - 'morning' or 'evening'
 * @param pricingConfig - the pricing config
 * @param machineId - optional machine ID for machine-specific pricing (e.g. YANTRA)
 */
export function getSlotPrice(
  category: 'MACHINE' | 'TENNIS',
  ballType: string,
  pitchType: string | null,
  timeSlab: 'morning' | 'evening',
  pricingConfig: PricingConfig,
  machineId?: string | null
): number {
  const pType = (pitchType as any) === 'TURF' ? 'CEMENT' : (pitchType || 'ASTRO');
  const validPType = (pType === 'ASTRO' || pType === 'CEMENT' || pType === 'NATURAL') ? pType : 'ASTRO';

  try {
    const tier = resolvePricingTier(category, ballType, machineId);
    return pricingConfig[tier][validPType][timeSlab].single;
  } catch (e) {
    console.error(`[Pricing] Error getting slot price for ${category}/${ballType}/${validPType}/${timeSlab}/${machineId}:`, e);
    const tier = resolvePricingTier(category, ballType, machineId);
    return DEFAULT_PRICING_CONFIG[tier][validPType][timeSlab].single;
  }
}

/**
 * Get the consecutive (2-slot) total price for a given configuration.
 */
export function getConsecutivePrice(
  category: 'MACHINE' | 'TENNIS',
  ballType: string,
  pitchType: string | null,
  timeSlab: 'morning' | 'evening',
  pricingConfig: PricingConfig,
  machineId?: string | null
): number {
  const pType = (pitchType as any) === 'TURF' ? 'CEMENT' : (pitchType || 'ASTRO');
  const validPType = (pType === 'ASTRO' || pType === 'CEMENT' || pType === 'NATURAL') ? pType : 'ASTRO';

  try {
    const tier = resolvePricingTier(category, ballType, machineId);
    return pricingConfig[tier][validPType][timeSlab].consecutive;
  } catch (e) {
    console.error(`[Pricing] Error getting consecutive price for ${category}/${ballType}/${validPType}/${timeSlab}/${machineId}:`, e);
    const tier = resolvePricingTier(category, ballType, machineId);
    return DEFAULT_PRICING_CONFIG[tier][validPType][timeSlab].consecutive;
  }
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
      const config = JSON.parse(policy.value);
      return normalizePricingConfig(config);
    }
  } catch (error) {
    console.warn('[Pricing] Error fetching/parsing config, using defaults:', error);
  }
  return DEFAULT_PRICING_CONFIG;
}

/**
 * Normalizes old pricing config structures to the current one.
 */
export function normalizePricingConfig(config: any): PricingConfig {
  // If it's already in the new format, return it
  if (config.leather && config.machine && config.tennis) {
    // Auto-populate yantra from leather if missing (backward compat)
    if (!config.yantra) {
      config.yantra = JSON.parse(JSON.stringify(config.leather));
    }
    // Auto-populate yantra_machine from machine if missing (backward compat)
    if (!config.yantra_machine) {
      config.yantra_machine = JSON.parse(JSON.stringify(config.machine || DEFAULT_PRICING_CONFIG.yantra_machine));
    }
    // Ensure all pitch types exist for each category
    const categories = ['leather', 'yantra', 'machine', 'yantra_machine', 'tennis'] as const;
    const pitches = ['ASTRO', 'CEMENT', 'NATURAL'] as const;
    const slabs = ['morning', 'evening'] as const;

    for (const cat of categories) {
      if (!config[cat]) config[cat] = {};
      for (const pitch of pitches) {
        if (!config[cat][pitch]) {
          config[cat][pitch] = JSON.parse(JSON.stringify(DEFAULT_PRICING_CONFIG[cat][pitch]));
        }
        for (const slab of slabs) {
          if (!config[cat][pitch][slab]) {
            config[cat][pitch][slab] = JSON.parse(JSON.stringify(DEFAULT_PRICING_CONFIG[cat][pitch][slab]));
          }
        }
      }
    }
    return config as PricingConfig;
  }

  // Handle migration from old format
  const normalized: any = JSON.parse(JSON.stringify(DEFAULT_PRICING_CONFIG));

  try {
    // Old leatherMachine.leather -> new leather
    if (config.leatherMachine?.leather) {
      for (const pitch of ['ASTRO', 'CEMENT', 'NATURAL'] as const) {
        normalized.leather[pitch] = config.leatherMachine.leather;
      }
    }

    // Old leatherMachine.machine -> new machine
    if (config.leatherMachine?.machine) {
      for (const pitch of ['ASTRO', 'CEMENT', 'NATURAL'] as const) {
        normalized.machine[pitch] = config.leatherMachine.machine;
      }
    }

    // Old tennisMachine -> new tennis.ASTRO
    if (config.tennisMachine) {
      normalized.tennis.ASTRO = config.tennisMachine;
    }

    // Old cementWicket -> new tennis.CEMENT and tennis.NATURAL
    if (config.cementWicket) {
      normalized.tennis.CEMENT = config.cementWicket;
      normalized.tennis.NATURAL = config.cementWicket;
    }
  } catch (e) {
    console.error('[Pricing] Failed to migrate old config:', e);
  }

  return normalized as PricingConfig;
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
  pricingConfig: PricingConfig,
  machineId?: string | null
): Array<{
  startTime: Date;
  endTime: Date;
  originalPrice: number;
  price: number;
  discountAmount: number;
}> {
  const sorted = [...slots].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

  // Check if consecutive
  let isConsecutive = false;
  if (sorted.length >= 2) {
    isConsecutive = sorted.every((slot, i) => {
      if (i === 0) return true;
      // Check if previous slot's end time matches current slot's start time
      return Math.abs(sorted[i - 1].endTime.getTime() - slot.startTime.getTime()) < 1000;
    });
  }

  return sorted.map(slot => {
    const slab = getTimeSlab(slot.startTime, timeSlabs);
    const singlePrice = getSlotPrice(category, ballType, pitchType, slab, pricingConfig, machineId);
    const consecutiveTotalFor2 = getConsecutivePrice(category, ballType, pitchType, slab, pricingConfig, machineId);
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
