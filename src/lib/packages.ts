import { prisma } from '@/lib/prisma';
import { type PackageMachineType, type PackageBallType, type PackageWicketType, type TimingType, type BallType, type PitchType } from '@prisma/client';
import { getTimeSlab, getTimeSlabConfig, type TimeSlabConfig } from '@/lib/pricing';

export interface ExtraChargeRules {
  ballTypeUpgrade?: number;   // e.g. 100 per half-hour for machine→leather upgrade
  wicketTypeUpgrade?: number; // Legacy: flat per half-hour for any wicket upgrade
  wicketTypeUpgrades?: Record<string, number>; // Per-path: e.g. { ASTRO_TO_CEMENT: 50, ASTRO_TO_NATURAL: 75 }
  timingUpgrade?: number;     // e.g. 125 per half-hour for day→evening upgrade
  machineUpgrades?: Record<string, number>; // Per-path: e.g. { GRAVITY_TO_YANTRA: 200 }
}

/**
 * Check if a package's machine type allows booking a given ballType.
 * LEATHER machine → LEATHER/MACHINE ball types
 * TENNIS machine → TENNIS ball type
 */
export function isMachineTypeCompatible(packageMachineType: PackageMachineType, bookingBallType: BallType): boolean {
  if (packageMachineType === 'LEATHER') {
    return bookingBallType === 'LEATHER' || bookingBallType === 'MACHINE';
  }
  // TENNIS machine
  return bookingBallType === 'TENNIS';
}

/**
 * Determine extra charge for ball type upgrade (Leather machine only).
 * Leather Ball Package → can book Machine Ball (no charge) or Leather Ball (no charge)
 * Machine Ball Package → can book Machine Ball (no charge) or Leather Ball (extra charge)
 */
export function getBallTypeExtraCharge(
  packageBallType: PackageBallType | null,
  bookingBallType: BallType,
  extraChargeRules: ExtraChargeRules
): number {
  if (!packageBallType) return 0;

  // BOTH or LEATHER package → no extra for any ball type
  if (packageBallType === 'BOTH' || packageBallType === 'LEATHER') return 0;

  // MACHINE package booking LEATHER ball → extra charge
  if (packageBallType === 'MACHINE' && bookingBallType === 'LEATHER') {
    return extraChargeRules.ballTypeUpgrade || 100;
  }

  return 0;
}

/**
 * Map booking PitchType to package wicket type equivalent for comparison.
 * PitchType TURF/CEMENT → CEMENT, ASTRO → ASTRO, NATURAL → NATURAL
 */
function pitchToWicket(pitchType: PitchType): string {
  if (pitchType === 'TURF' || pitchType === 'CEMENT') return 'CEMENT';
  return pitchType; // ASTRO or NATURAL
}

// Wicket type hierarchy: ASTRO (0) < CEMENT (1) < NATURAL (2)
const WICKET_RANK: Record<string, number> = { ASTRO: 0, CEMENT: 1, NATURAL: 2 };

/**
 * Determine extra charge for wicket/pitch type upgrade.
 * Supports both legacy flat pricing and per-path pricing.
 */
export function getWicketTypeExtraCharge(
  packageWicketType: PackageWicketType | null,
  bookingPitchType: PitchType | null,
  extraChargeRules: ExtraChargeRules
): number {
  if (!packageWicketType || !bookingPitchType) return 0;
  if (packageWicketType === 'BOTH') return 0;

  const bookingWicket = pitchToWicket(bookingPitchType);
  const pkgRank = WICKET_RANK[packageWicketType] ?? 0;
  const bookingRank = WICKET_RANK[bookingWicket] ?? 0;

  // No upgrade needed if booking same or lower tier
  if (bookingRank <= pkgRank) return 0;

  // New format: per-path upgrade pricing
  if (extraChargeRules.wicketTypeUpgrades) {
    const key = `${packageWicketType}_TO_${bookingWicket}`;
    const pathPrice = extraChargeRules.wicketTypeUpgrades[key];
    if (pathPrice !== undefined) return pathPrice;
  }

  // Legacy fallback: flat wicketTypeUpgrade
  return extraChargeRules.wicketTypeUpgrade || 50;
}

/**
 * Determine extra charge for machine upgrade.
 * If the booking is on a different (higher-tier) machine than the package, apply the upgrade charge.
 */
export function getMachineExtraCharge(
  packageMachineId: string | null,
  bookingMachineId: string | null,
  extraChargeRules: ExtraChargeRules
): number {
  if (!packageMachineId || !bookingMachineId) return 0;
  if (packageMachineId === bookingMachineId) return 0;

  if (extraChargeRules.machineUpgrades) {
    const key = `${packageMachineId}_TO_${bookingMachineId}`;
    const pathPrice = extraChargeRules.machineUpgrades[key];
    if (pathPrice !== undefined && pathPrice > 0) return pathPrice;
  }

  return 0;
}

/**
 * Determine extra charge for timing upgrade.
 * Evening Package → can book Day or Evening (no charge)
 * Day Package → can book Day (no charge) or Evening (extra charge)
 */
export function getTimingExtraCharge(
  packageTimingType: TimingType,
  slotTimeSlab: 'morning' | 'evening',
  extraChargeRules: ExtraChargeRules
): number {
  // BOTH or EVENING package → no extra
  if (packageTimingType === 'BOTH' || packageTimingType === 'EVENING') return 0;

  // DAY package booking evening slot → extra charge
  if (packageTimingType === 'DAY' && slotTimeSlab === 'evening') {
    return extraChargeRules.timingUpgrade || 125;
  }

  return 0;
}

/**
 * Calculate total extra charge for a package booking.
 */
export function calculatePackageExtraCharge(
  pkg: {
    machineId?: string | null;
    machineType: PackageMachineType;
    ballType: PackageBallType | null;
    wicketType: PackageWicketType | null;
    timingType: TimingType;
    extraChargeRules: ExtraChargeRules | null;
  },
  booking: {
    machineId?: string | null;
    ballType: BallType;
    pitchType: PitchType | null;
    slotTimeSlab: 'morning' | 'evening';
  }
): { totalExtra: number; breakdown: { ballTypeExtra: number; wicketTypeExtra: number; timingExtra: number; machineExtra: number } } {
  const rules = pkg.extraChargeRules || {};

  const ballTypeExtra = getBallTypeExtraCharge(pkg.ballType, booking.ballType, rules);
  const wicketTypeExtra = getWicketTypeExtraCharge(pkg.wicketType, booking.pitchType, rules);
  const timingExtra = getTimingExtraCharge(pkg.timingType, booking.slotTimeSlab, rules);
  const machineExtra = getMachineExtraCharge(pkg.machineId || null, booking.machineId || null, rules);

  return {
    totalExtra: ballTypeExtra + wicketTypeExtra + timingExtra + machineExtra,
    breakdown: { ballTypeExtra, wicketTypeExtra, timingExtra, machineExtra },
  };
}

/**
 * Get a user's active packages (not expired, not cancelled, has remaining sessions).
 */
export async function getUserActivePackages(userId: string) {
  const now = new Date();
  const farFutureThreshold = new Date('2099-01-01T00:00:00.000Z');

  // First, auto-expire any packages past their expiry date
  // Skip packages with far-future expiry (pending activation - validity starts on first booking)
  await prisma.userPackage.updateMany({
    where: {
      userId,
      status: 'ACTIVE',
      expiryDate: { lt: now },
    },
    data: { status: 'EXPIRED' },
  });

  return prisma.userPackage.findMany({
    where: {
      userId,
      status: 'ACTIVE',
      OR: [
        { expiryDate: { gte: now } },
        { expiryDate: { gte: farFutureThreshold } }, // Pending activation packages
      ],
    },
    include: {
      package: true,
      packageBookings: {
        include: {
          booking: true,
        },
        orderBy: { createdAt: 'desc' },
      },
    },
    orderBy: { expiryDate: 'asc' },
  });
}

/**
 * Validate that a user package can be used for a booking.
 * Returns the extra charge info or an error.
 */
export async function validatePackageBooking(
  userPackageId: string,
  userId: string,
  bookingBallType: BallType,
  bookingPitchType: PitchType | null,
  slotStartTime: Date,
  numberOfSlots: number = 1,
  timeSlabConfig?: TimeSlabConfig,
  bookingMachineId?: string | null
): Promise<{
  valid: boolean;
  error?: string;
  extraCharge?: number;
  extraChargeType?: string;
  breakdown?: { ballTypeExtra: number; wicketTypeExtra: number; timingExtra: number; machineExtra: number };
}> {
  const now = new Date();

  const userPackage = await prisma.userPackage.findUnique({
    where: { id: userPackageId },
    include: { package: true },
  });

  if (!userPackage) {
    return { valid: false, error: 'Package not found' };
  }

  if (userPackage.userId !== userId) {
    return { valid: false, error: 'Package does not belong to this user' };
  }

  if (userPackage.status !== 'ACTIVE') {
    return { valid: false, error: 'Package is not active' };
  }

  if (userPackage.expiryDate < now) {
    // Auto-expire
    await prisma.userPackage.update({
      where: { id: userPackageId },
      data: { status: 'EXPIRED' },
    });
    return { valid: false, error: 'Package has expired' };
  }

  // Check if booking date is within package validity
  if (slotStartTime > userPackage.expiryDate) {
    return { valid: false, error: 'Slot is after package expiry date' };
  }

  const remainingSessions = userPackage.totalSessions - userPackage.usedSessions;
  if (remainingSessions < numberOfSlots) {
    return { valid: false, error: `Not enough sessions. Remaining: ${remainingSessions}, Required: ${numberOfSlots}` };
  }

  // Machine type check
  if (!isMachineTypeCompatible(userPackage.package.machineType, bookingBallType)) {
    return { valid: false, error: `Package machine type (${userPackage.package.machineType}) does not support ${bookingBallType} ball type` };
  }

  // Calculate extra charges
  const tsConfig = timeSlabConfig || await getTimeSlabConfig();
  const slotTimeSlab = getTimeSlab(slotStartTime, tsConfig);

  const { totalExtra, breakdown } = calculatePackageExtraCharge(
    {
      machineId: userPackage.package.machineId,
      machineType: userPackage.package.machineType,
      ballType: userPackage.package.ballType,
      wicketType: userPackage.package.wicketType,
      timingType: userPackage.package.timingType,
      extraChargeRules: userPackage.package.extraChargeRules as ExtraChargeRules | null,
    },
    {
      machineId: bookingMachineId || null,
      ballType: bookingBallType,
      pitchType: bookingPitchType,
      slotTimeSlab,
    }
  );

  // Determine extra charge type for record
  let extraChargeType: string | undefined;
  if (breakdown.machineExtra > 0) extraChargeType = 'MACHINE';
  else if (breakdown.ballTypeExtra > 0) extraChargeType = 'BALL_TYPE';
  else if (breakdown.wicketTypeExtra > 0) extraChargeType = 'WICKET_TYPE';
  else if (breakdown.timingExtra > 0) extraChargeType = 'TIMING';

  return {
    valid: true,
    extraCharge: totalExtra * numberOfSlots,
    extraChargeType,
    breakdown,
  };
}
