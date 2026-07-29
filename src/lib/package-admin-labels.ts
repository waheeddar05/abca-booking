/**
 * Standardized labels for the admin Packages UI (and supporting
 * exports like the package CSV). These are presentation-layer aliases
 * over the underlying Prisma enums — the DB values are unchanged.
 *
 * Use these wherever the admin form / cards / CSV need to display:
 *   - Wicket Type    (Natural Turf / Cement / Astroturf)
 *   - Ball Type      (Leather / Machine) — Bowling Machine category only
 *   - Timing         (Day / Evening)
 *   - Package Booking Category (Bowling Machine / Cricket Nets / …)
 *
 * Keeping these in one module means future tweaks (wording, new
 * categories) only need to land here, and the CSV stays in sync with
 * the UI by construction.
 */

import { BOOKING_CATEGORY_LABELS, bookingCategoryLabel } from '@/lib/booking-categories';

// ─── Wicket / Pitch ──────────────────────────────────────
// Canonical admin-facing wicket labels. Values match the
// PackageWicketType enum (ASTRO / CEMENT / NATURAL) — only the labels
// are renamed (e.g. "Astro Turf" → "Astroturf").
export const PACKAGE_WICKET_OPTIONS = [
  { value: 'ASTRO',   label: 'Astroturf' },
  { value: 'CEMENT',  label: 'Cement' },
  { value: 'NATURAL', label: 'Natural Turf' },
] as const;

export const PACKAGE_WICKET_LABEL: Record<string, string> = Object.fromEntries(
  PACKAGE_WICKET_OPTIONS.map((o) => [o.value, o.label]),
);

// ─── Ball Type (Bowling Machine category only) ───────────
// Trimmed down from the old "Leather Balls Only / Machine Balls Only"
// wording. The DB still uses MACHINE / LEATHER (and BOTH, retained
// as an admin-only option for legacy packages, but no longer
// surfaced as a default new-package choice).
export const PACKAGE_BALL_OPTIONS = [
  { value: 'LEATHER', label: 'Leather' },
  { value: 'MACHINE', label: 'Machine' },
] as const;

// Tennis machines (Master 200 / iWinner / Leverage) have a Machine /
// Tennis ball-type axis — the mirror of the leather machines' Machine /
// Leather axis. "Leather" is never a valid choice for a tennis machine.
export const PACKAGE_BALL_TENNIS_OPTIONS = [
  { value: 'MACHINE', label: 'Machine' },
  { value: 'TENNIS', label: 'Tennis' },
] as const;

export const PACKAGE_BALL_LABEL: Record<string, string> = {
  LEATHER: 'Leather',
  MACHINE: 'Machine',
  TENNIS: 'Tennis',
};

// Fixed Ball Type choices for the admin Assign Package form. Unlike the
// create/edit forms (whose options are derived from the selected
// machine's effective ball types), the Assign tab offers an explicit,
// machine-independent pick of Leather / Tennis / Machine — the admin
// records the ball type the assigned package is for, and it is saved
// verbatim. Order matches the product spec.
export const PACKAGE_BALL_ALL_OPTIONS = [
  { value: 'LEATHER', label: 'Leather' },
  { value: 'TENNIS', label: 'Tennis' },
  { value: 'MACHINE', label: 'Machine' },
] as const;

/**
 * Ball-type dropdown options valid for a machine's category.
 *   - Leather machines (Gravity / Yantra) → Machine / Leather.
 *   - Tennis machines (Master 200 / iWinner / Leverage) → Machine / Tennis.
 * `machineBallType` is the MachineType.ballType ('LEATHER' | 'TENNIS' | …)
 * — which also equals the Package.machineType axis.
 */
export function ballOptionsForMachineType(machineBallType: string | null | undefined) {
  return machineBallType === 'TENNIS' ? PACKAGE_BALL_TENNIS_OPTIONS : PACKAGE_BALL_OPTIONS;
}

/**
 * Single source of truth for machine-type ↔ ball-type compatibility.
 * Shared by the admin UI (gating + client validation) and the API
 * routes (server-side enforcement). A null/empty ballType is allowed —
 * the column is optional on the Package row.
 *   - LEATHER machine → MACHINE | LEATHER | BOTH (BOTH kept for legacy rows).
 *   - TENNIS  machine → MACHINE | TENNIS.
 */
export function isBallTypeValidForMachineType(
  machineType: string | null | undefined,
  ballType: string | null | undefined,
): boolean {
  if (!ballType) return true;
  if (machineType === 'TENNIS') {
    return ballType === 'MACHINE' || ballType === 'TENNIS';
  }
  return ballType === 'MACHINE' || ballType === 'LEATHER' || ballType === 'BOTH';
}

/**
 * Pick a valid ball type for a machine category, preserving the current
 * value when it's still valid and otherwise falling back to the natural
 * default (Leather for leather machines, Tennis for tennis machines).
 * Used to auto-clear an incompatible selection when the machine changes.
 */
export function coerceBallTypeForMachineType(
  machineType: string | null | undefined,
  currentBallType: string | null | undefined,
): string {
  if (currentBallType && isBallTypeValidForMachineType(machineType, currentBallType)) {
    return currentBallType;
  }
  return machineType === 'TENNIS' ? 'TENNIS' : 'LEATHER';
}

/**
 * Build Ball Type dropdown options from a machine's *effective* ball
 * types — the `effectiveBallTypes` array returned per machine by
 * /api/centers/[id]/machines. This is the real source of truth and
 * honours both the machine's category and any admin per-machine
 * restriction:
 *   - Tennis machines resolve to ['TENNIS'] → only "Tennis".
 *   - Leather machines resolve to ['LEATHER','MACHINE'] → "Leather" / "Machine".
 * Falls back to Machine / Leather when the list is missing (e.g. no
 * machine pinned yet in the resource-based form).
 */
export function ballOptionsFromEffective(
  effectiveBallTypes: string[] | null | undefined,
): Array<{ value: string; label: string }> {
  const list = effectiveBallTypes && effectiveBallTypes.length > 0
    ? effectiveBallTypes
    : ['LEATHER', 'MACHINE'];
  return list.map((v) => ({ value: v, label: PACKAGE_BALL_LABEL[v] || v }));
}

/**
 * Pick a valid ball type for a machine's effective list — keep the
 * current value when it's still offered, otherwise default to the first
 * option. Used to auto-clear an incompatible selection when the pinned
 * machine changes.
 */
export function coerceBallTypeFromEffective(
  effectiveBallTypes: string[] | null | undefined,
  currentBallType: string | null | undefined,
): string {
  const opts = ballOptionsFromEffective(effectiveBallTypes);
  if (currentBallType && opts.some((o) => o.value === currentBallType)) {
    return currentBallType;
  }
  return opts[0]?.value ?? 'MACHINE';
}

// ─── Timing ──────────────────────────────────────────────
// Plain "Day" / "Evening" everywhere. We drop the time-window
// subtitle from option labels — the form still shows a hint underneath
// the picker if needed, but the dropdown values themselves are kept
// short.
export const PACKAGE_TIMING_OPTIONS = [
  { value: 'DAY',     label: 'Day' },
  { value: 'EVENING', label: 'Evening' },
] as const;

export const PACKAGE_TIMING_LABEL: Record<string, string> = {
  DAY:     'Day',
  EVENING: 'Evening',
};

export const PACKAGE_TIMING_DAY_LABEL = '6 a.m. to 6 p.m.';
export const PACKAGE_TIMING_EVENING_LABEL = '6 p.m. to 10:30 p.m.';

// ─── Booking Category ────────────────────────────────────
// Surfaced as a column in the packages CSV and in the user-style admin
// cards. Re-exported straight from `booking-categories.ts` rather than
// re-typed here: the packages CSV and the bookings CSV name a category
// identically because they read the same map, not because two lists
// happen to agree today. That also means every `BookingCategory` is
// covered — a Corporate Batch or Match Simulation package used to fall
// through the old five-entry map and export as "Bowling Machine".
export const PACKAGE_CATEGORY_LABEL: Record<string, string> = { ...BOOKING_CATEGORY_LABELS };

/**
 * Resolve a Package row to its booking-category label for display /
 * CSV — always the base category, never a purchase-mode suffix. Falls
 * back to "Bowling Machine" when the package row has no `category` set
 * (legacy ABCA packages predate the column).
 */
export function packageCategoryLabel(category: string | null | undefined): string {
  return bookingCategoryLabel(category);
}

/** True for categories where ball type is a meaningful axis. Mirrors
 *  the convention used by the bookings export — non-machine bookings
 *  print "Not Applicable" in the Ball Type column. */
export function categoryUsesBallType(category: string | null | undefined): boolean {
  return !category || category === 'MACHINE';
}
