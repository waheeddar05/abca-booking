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
 * All three resolve from `CenterPolicy` ONLY — never from the global Policy
 * table. RESOURCE_BASED centers (Toplay et al.) are intentionally isolated
 * from platform-wide defaults so no global override can sneak into their
 * booking surface. Missing center-scoped value falls back to
 * `ALL_PITCH_TYPES` / `ALL_BOOKABLE_CATEGORIES`.
 */
import { getCenterOnlyPolicyJson } from '@/lib/policy';
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

/**
 * Same idea for ball types — empty configured list means "no admin
 * restriction; offer the natural set for this machine type". A leather-
 * type machine (Yantra, Gravity) physically supports both leather and
 * machine balls, so the fallback for those exposes both. Tennis-type
 * machines fall back to TENNIS only. Anything else falls back to the
 * full universe so the chip row stays visible.
 */
export function effectiveBallTypes(
  machineBallTypes: BallTypeId[],
  fallbackTypeBall: string | null | undefined,
): BallTypeId[] {
  if (machineBallTypes.length > 0) return machineBallTypes;
  if (fallbackTypeBall === 'LEATHER') return ['LEATHER', 'MACHINE'];
  if (fallbackTypeBall === 'TENNIS') return ['TENNIS'];
  if (fallbackTypeBall === 'MACHINE') return ['MACHINE'];
  return ALL_BALL_TYPES;
}

export async function getSidearmPitchTypes(centerId: string): Promise<PitchType[]> {
  const list = await getCenterOnlyPolicyJson<PitchType[]>(
    'SIDEARM_PITCH_TYPES',
    centerId,
    ALL_PITCH_TYPES,
  );
  // Guard against bad JSON (e.g. someone wrote {} instead of []).
  return Array.isArray(list) && list.length > 0 ? list : ALL_PITCH_TYPES;
}

export async function getNetPitchTypes(centerId: string): Promise<PitchType[]> {
  const list = await getCenterOnlyPolicyJson<PitchType[]>(
    'NET_PITCH_TYPES',
    centerId,
    ALL_PITCH_TYPES,
  );
  return Array.isArray(list) && list.length > 0 ? list : ALL_PITCH_TYPES;
}

/**
 * Personal Coaching pitch types — same admin-editable policy shape as
 * Sidearm + Net. Read by the user-side slot picker so admins can hide
 * specific pitches (e.g. drop Cement) without touching the engine.
 */
export async function getCoachingPitchTypes(centerId: string): Promise<PitchType[]> {
  const list = await getCenterOnlyPolicyJson<PitchType[]>(
    'COACHING_PITCH_TYPES',
    centerId,
    ALL_PITCH_TYPES,
  );
  return Array.isArray(list) && list.length > 0 ? list : ALL_PITCH_TYPES;
}

/**
 * Booking categories enabled for the user-facing slot picker at this
 * center. Drives the visible tabs on /slots. Stored as a JSON array;
 * anything missing or invalid falls back to "everything is enabled".
 */
export type BookableCategoryId =
  | 'MACHINE'
  | 'NET'
  | 'SIDEARM'
  | 'COACHING'
  // CORPORATE_BATCH is preserved as a DB enum value for back-compat
  // with any historical bookings / policies, but is intentionally
  // omitted from the user/admin-facing category lists. Adding it
  // back would require restoring the editor row + the user-side tab
  // and a category card; the engine still understands it if a
  // CenterPolicy explicitly re-enables it via raw JSON.
  | 'FULL_COURT';

export const ALL_BOOKABLE_CATEGORIES: BookableCategoryId[] = [
  'MACHINE',
  'NET',
  'SIDEARM',
  'COACHING',
  'FULL_COURT',
];

export async function getEnabledBookingCategories(
  centerId: string,
): Promise<BookableCategoryId[]> {
  const list = await getCenterOnlyPolicyJson<BookableCategoryId[]>(
    'ENABLED_BOOKING_CATEGORIES',
    centerId,
    ALL_BOOKABLE_CATEGORIES,
  );
  if (!Array.isArray(list)) return ALL_BOOKABLE_CATEGORIES;
  // Keep only known IDs in the canonical order — guards against typos
  // or an admin saving a stale category that no longer exists.
  const set = new Set(list);
  const filtered = ALL_BOOKABLE_CATEGORIES.filter((c) => set.has(c));
  return filtered.length > 0 ? filtered : ALL_BOOKABLE_CATEGORIES;
}
