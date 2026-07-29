/**
 * Booking categories — one canonical label per `BookingCategory`, shared
 * by every admin surface that has to name one: the bookings CSV, the
 * packages CSV, the admin list filters, and the Assign Package picker.
 *
 * Keeping the map in one place is what makes those surfaces agree. A
 * category reads identically in every file a finance reviewer opens, and
 * adding a category is one edit rather than five.
 *
 * **The label is always the base category.** Corporate Batch and Match
 * Simulation rows also carry a purchase mode (`corporateBatchMode`) and
 * an enrollment period, but those never appear in the label — a CSV
 * column that sometimes reads "Match Simulation" and sometimes "Match
 * Simulation (Monthly · 2026-07)" cannot be grouped or pivoted without
 * being normalised first, which is exactly the work the sheet is
 * supposed to save.
 *
 * Client-safe: no Prisma, no policy lookups. *Which* categories a given
 * center offers comes from `getEnabledBookingCategories`
 * (`src/lib/pitch-config.ts`, server-only); this module only names them.
 */

/** Every `BookingCategory` enum value, in canonical display order. */
export const BOOKING_CATEGORIES = [
  'MACHINE',
  'NET',
  'SIDEARM',
  'COACHING',
  'FULL_COURT',
  'CORPORATE_BATCH',
  'MATCH_SIMULATION',
] as const;

export type BookingCategoryId = (typeof BOOKING_CATEGORIES)[number];

export const BOOKING_CATEGORY_LABELS: Record<BookingCategoryId, string> = {
  MACHINE: 'Bowling Machine',
  NET: 'Cricket Nets',
  SIDEARM: 'Sidearm',
  COACHING: 'Personal Coaching',
  FULL_COURT: 'Full Indoor Court',
  CORPORATE_BATCH: 'Corporate Batch',
  MATCH_SIMULATION: 'Match Simulation',
};

/**
 * The two real categories behind the user-facing "Match Practice" tab.
 * `MATCH_PRACTICE` is a UI umbrella in `ENABLED_BOOKING_CATEGORIES`, not
 * a `BookingCategory` value — bookings made from that tab persist as one
 * of these.
 */
export const MATCH_PRACTICE_CATEGORIES: BookingCategoryId[] = [
  'CORPORATE_BATCH',
  'MATCH_SIMULATION',
];

export function isMatchPracticeCategory(raw: string | null | undefined): boolean {
  return raw === 'CORPORATE_BATCH' || raw === 'MATCH_SIMULATION';
}

/**
 * Label for a stored `Booking.category` / `Package.category`.
 *
 * Null falls back to "Bowling Machine": legacy ABCA rows predate the
 * column and are all bowling-machine sessions. An unrecognised code is
 * returned verbatim rather than being absorbed into that fallback, so a
 * category added to the enum but not to this map shows up as its code
 * instead of quietly mislabelling itself as a machine booking.
 */
export function bookingCategoryLabel(raw: string | null | undefined): string {
  if (!raw) return BOOKING_CATEGORY_LABELS.MACHINE;
  return BOOKING_CATEGORY_LABELS[raw as BookingCategoryId] ?? raw;
}

/**
 * Turn a center's `ENABLED_BOOKING_CATEGORIES` list into the real
 * `BookingCategory` values it implies: the `MATCH_PRACTICE` umbrella
 * expands into Corporate Batch + Match Simulation, unknown entries are
 * dropped, and the result is de-duplicated into canonical order.
 *
 * An empty or missing list means "everything is enabled" — the same
 * fallback `getEnabledBookingCategories` applies server-side, so a
 * center that has never saved the policy still sees every category.
 */
export function expandBookableCategories(
  enabled: readonly string[] | null | undefined,
): BookingCategoryId[] {
  if (!Array.isArray(enabled) || enabled.length === 0) return [...BOOKING_CATEGORIES];
  const set = new Set<string>();
  for (const c of enabled) {
    if (c === 'MATCH_PRACTICE') {
      for (const m of MATCH_PRACTICE_CATEGORIES) set.add(m);
    } else {
      set.add(c);
    }
  }
  const filtered = BOOKING_CATEGORIES.filter((c) => set.has(c));
  return filtered.length > 0 ? filtered : [...BOOKING_CATEGORIES];
}

/** `{ id, label }` options for a category `<select>`, ready to render. */
export function bookingCategoryOptions(
  enabled: readonly string[] | null | undefined,
): Array<{ id: BookingCategoryId; label: string }> {
  return expandBookableCategories(enabled).map((id) => ({
    id,
    label: BOOKING_CATEGORY_LABELS[id],
  }));
}
