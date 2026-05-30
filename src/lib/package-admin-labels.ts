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

export const PACKAGE_BALL_LABEL: Record<string, string> = {
  LEATHER: 'Leather',
  MACHINE: 'Machine',
};

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
// Surfaced as a column in the packages CSV and in the user-style
// admin cards. Mirrors the labels used by the booking export so the
// two CSVs stay aligned for finance reviewers.
export const PACKAGE_CATEGORY_LABEL: Record<string, string> = {
  MACHINE:    'Bowling Machine',
  SIDEARM:    'Sidearm',
  NET:        'Cricket Nets',
  FULL_COURT: 'Full Indoor Court',
  COACHING:   'Personal Coaching',
};

/**
 * Resolve a Package row to its booking-category label for display /
 * CSV. Falls back to "Bowling Machine" when the package row has no
 * `category` set (legacy ABCA packages predate the column).
 */
export function packageCategoryLabel(category: string | null | undefined): string {
  if (!category) return 'Bowling Machine';
  return PACKAGE_CATEGORY_LABEL[category] || 'Bowling Machine';
}

/** True for categories where ball type is a meaningful axis. Mirrors
 *  the convention used by the bookings export — non-machine bookings
 *  print "Not Applicable" in the Ball Type column. */
export function categoryUsesBallType(category: string | null | undefined): boolean {
  return !category || category === 'MACHINE';
}
