/**
 * Per-center supported pitch types for booking categories that don't tie
 * back to a specific machine row.
 *
 * - **Machine bookings**: pitch types come from the picked
 *   `Machine.supportedPitchTypes` row; if that array is empty we fall back
 *   to the universe (all four enum values) so the chip row never disappears
 *   on a half-configured machine.
 * - **Sidearm bookings**: there's no machine row to read from, so we read
 *   `SIDEARM_PITCH_TYPES` from the per-center policy.
 * - **Net bookings**: same idea — `NET_PITCH_TYPES` per-center.
 *
 * All three respect the standard policy resolver (center override → global
 * default → code-level fallback in `ALL_PITCH_TYPES`).
 */
import { getPolicyJson } from '@/lib/policy';
import type { PitchType } from '@prisma/client';

/**
 * Pitch types currently exposed in the booking UI. Centers offer three
 * surfaces — Astro Turf, Cement, and Natural Turf. The legacy 'TURF'
 * enum value is kept in the database for back-compat with rows that may
 * already reference it, but it is no longer offered to users or admins.
 */
export const ALL_PITCH_TYPES: PitchType[] = ['ASTRO', 'CEMENT', 'NATURAL'];

/** Universe of ball types — used as the fallback for ball-type chip rows. */
export type BallTypeId = 'TENNIS' | 'LEATHER' | 'MACHINE';
export const ALL_BALL_TYPES: BallTypeId[] = ['LEATHER', 'TENNIS', 'MACHINE'];

/**
 * If the per-machine list is empty, treat that as "no admin restriction" and
 * default to every pitch type. Keeps the user-facing chip row from
 * disappearing the moment an admin adds a new machine without configuring
 * it yet.
 */
export function effectivePitchTypes(machinePitchTypes: PitchType[]): PitchType[] {
  return machinePitchTypes.length > 0 ? machinePitchTypes : ALL_PITCH_TYPES;
}

/** Same idea for ball types. */
export function effectiveBallTypes(
  machineBallTypes: BallTypeId[],
  fallbackTypeBall: string | null | undefined,
): BallTypeId[] {
  if (machineBallTypes.length > 0) return machineBallTypes;
  // Fall back to the MachineType.ballType (single value, e.g. 'LEATHER').
  if (fallbackTypeBall && (ALL_BALL_TYPES as string[]).includes(fallbackTypeBall)) {
    return [fallbackTypeBall as BallTypeId];
  }
  return ALL_BALL_TYPES;
}

export async function getSidearmPitchTypes(centerId: string): Promise<PitchType[]> {
  const list = await getPolicyJson<PitchType[]>(
    'SIDEARM_PITCH_TYPES',
    centerId,
    ALL_PITCH_TYPES,
  );
  // Guard against bad JSON (e.g. someone wrote {} instead of []).
  return Array.isArray(list) && list.length > 0 ? list : ALL_PITCH_TYPES;
}

export async function getNetPitchTypes(centerId: string): Promise<PitchType[]> {
  const list = await getPolicyJson<PitchType[]>(
    'NET_PITCH_TYPES',
    centerId,
    ALL_PITCH_TYPES,
  );
  return Array.isArray(list) && list.length > 0 ? list : ALL_PITCH_TYPES;
}
