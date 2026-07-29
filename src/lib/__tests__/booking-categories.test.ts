import { describe, it, expect } from 'vitest';
import {
  BOOKING_CATEGORIES,
  BOOKING_CATEGORY_LABELS,
  bookingCategoryLabel,
  bookingCategoryOptions,
  expandBookableCategories,
  isMatchPracticeCategory,
} from '@/lib/booking-categories';
import { packageCategoryLabel } from '@/lib/package-admin-labels';

describe('bookingCategoryLabel', () => {
  it('labels every BookingCategory', () => {
    for (const c of BOOKING_CATEGORIES) {
      expect(BOOKING_CATEGORY_LABELS[c], `missing label for ${c}`).toBeTruthy();
    }
  });

  it('exports the base category for Match Practice — no mode suffix', () => {
    expect(bookingCategoryLabel('MATCH_SIMULATION')).toBe('Match Simulation');
    expect(bookingCategoryLabel('CORPORATE_BATCH')).toBe('Corporate Batch');
  });

  it('never produces a "(Regular)" / "(Monthly)" suffix', () => {
    for (const c of BOOKING_CATEGORIES) {
      expect(bookingCategoryLabel(c)).not.toMatch(/\(/);
    }
  });

  it('falls back to Bowling Machine for legacy rows with no category', () => {
    expect(bookingCategoryLabel(null)).toBe('Bowling Machine');
    expect(bookingCategoryLabel(undefined)).toBe('Bowling Machine');
    expect(bookingCategoryLabel('')).toBe('Bowling Machine');
  });

  it('returns an unknown code verbatim rather than mislabelling it', () => {
    expect(bookingCategoryLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });
});

describe('packages CSV labels match the bookings CSV', () => {
  it('agrees on every category, Match Practice included', () => {
    for (const c of BOOKING_CATEGORIES) {
      expect(packageCategoryLabel(c)).toBe(bookingCategoryLabel(c));
    }
  });

  it('no longer exports a Corporate Batch package as "Bowling Machine"', () => {
    expect(packageCategoryLabel('CORPORATE_BATCH')).toBe('Corporate Batch');
    expect(packageCategoryLabel('MATCH_SIMULATION')).toBe('Match Simulation');
  });

  it('keeps the legacy null fallback', () => {
    expect(packageCategoryLabel(null)).toBe('Bowling Machine');
  });
});

describe('expandBookableCategories', () => {
  it('expands the MATCH_PRACTICE umbrella into its two real categories', () => {
    expect(expandBookableCategories(['MACHINE', 'MATCH_PRACTICE'])).toEqual([
      'MACHINE',
      'CORPORATE_BATCH',
      'MATCH_SIMULATION',
    ]);
  });

  it('never returns the umbrella itself — it is not a BookingCategory', () => {
    expect(expandBookableCategories(['MATCH_PRACTICE'])).not.toContain('MATCH_PRACTICE');
  });

  it('drops a disabled category', () => {
    expect(expandBookableCategories(['MACHINE', 'NET'])).toEqual(['MACHINE', 'NET']);
  });

  it('drops unknown entries and de-duplicates into canonical order', () => {
    expect(expandBookableCategories(['NET', 'BOGUS', 'MACHINE', 'NET'])).toEqual([
      'MACHINE',
      'NET',
    ]);
  });

  it('treats an empty or missing policy as "everything enabled"', () => {
    expect(expandBookableCategories([])).toEqual([...BOOKING_CATEGORIES]);
    expect(expandBookableCategories(null)).toEqual([...BOOKING_CATEGORIES]);
    expect(expandBookableCategories(undefined)).toEqual([...BOOKING_CATEGORIES]);
  });

  it('falls back to everything when nothing in the list is recognised', () => {
    expect(expandBookableCategories(['NOPE'])).toEqual([...BOOKING_CATEGORIES]);
  });
});

describe('bookingCategoryOptions', () => {
  it('renders labelled options in canonical order', () => {
    expect(bookingCategoryOptions(['SIDEARM', 'MACHINE'])).toEqual([
      { id: 'MACHINE', label: 'Bowling Machine' },
      { id: 'SIDEARM', label: 'Sidearm' },
    ]);
  });

  it('offers every category — including Full Indoor Court and Personal Coaching', () => {
    const ids = bookingCategoryOptions(null).map((o) => o.id);
    expect(ids).toContain('FULL_COURT');
    expect(ids).toContain('COACHING');
    expect(ids).toContain('NET');
    expect(ids).toContain('SIDEARM');
  });
});

describe('isMatchPracticeCategory', () => {
  it('is true for exactly the two seat-based categories', () => {
    expect(isMatchPracticeCategory('CORPORATE_BATCH')).toBe(true);
    expect(isMatchPracticeCategory('MATCH_SIMULATION')).toBe(true);
    expect(isMatchPracticeCategory('MACHINE')).toBe(false);
    expect(isMatchPracticeCategory(null)).toBe(false);
  });
});
