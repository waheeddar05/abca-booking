import { describe, it, expect } from 'vitest';
import {
  normalizeCorporateBatchSettings,
  normalizeMatchSimulationSettings,
  DEFAULT_CORPORATE_BATCH_SETTINGS,
  parseEnrollmentPeriod,
  formatPeriodLabel,
  overlappingPeriods,
  periodsCoveringDate,
  istDateTimeToUTC,
  dayOfWeekOf,
  listCorporateSessionDates,
  listMatchSimOccurrences,
  firstUpcomingSessionInPeriod,
  listMonthKeys,
} from '@/lib/match-practice';

describe('normalizeCorporateBatchSettings', () => {
  it('returns defaults for null/garbage input', () => {
    expect(normalizeCorporateBatchSettings(null)).toEqual(DEFAULT_CORPORATE_BATCH_SETTINGS);
    expect(normalizeCorporateBatchSettings('nope')).toEqual(DEFAULT_CORPORATE_BATCH_SETTINGS);
  });

  it('merges a legacy resource-hold-only policy with the new defaults', () => {
    // Old CORPORATE_BATCH_CONFIG rows only carried these five fields.
    const legacy = {
      enabled: true,
      days: [1, 2, 3, 4, 5],
      startTime: '07:30',
      endTime: '09:30',
      netsConsumed: 3,
    };
    const merged = normalizeCorporateBatchSettings(legacy);
    expect(merged.enabled).toBe(true);
    expect(merged.days).toEqual([1, 2, 3, 4, 5]);
    expect(merged.startTime).toBe('07:30');
    expect(merged.netsConsumed).toBe(3);
    // New enrollment knobs fall back to requirement defaults.
    expect(merged.coachName).toBe('Govind Lashkare');
    expect(merged.monthlyFee).toBe(2000);
    expect(merged.regularFee).toBe(200);
    expect(merged.maxCapacity).toBe(25);
    expect(merged.halfMonth.enabled).toBe(false);
  });

  it('drops invalid day numbers and clamps capacity/splitDay', () => {
    const merged = normalizeCorporateBatchSettings({
      days: [0, 7, -1, 3],
      maxCapacity: 0,
      halfMonth: { splitDay: 31 },
    });
    expect(merged.days).toEqual([0, 3]);
    expect(merged.maxCapacity).toBeGreaterThanOrEqual(1);
    expect(merged.halfMonth.splitDay).toBeLessThanOrEqual(27);
  });

  it('reads the per-session fee from the legacy adhocFee key', () => {
    // Configs saved before the Ad-hoc → Regular rename stored the
    // per-session fee under `adhocFee` — it must survive the rename.
    expect(normalizeCorporateBatchSettings({ adhocFee: 350 }).regularFee).toBe(350);
    // New key wins when both are present.
    expect(normalizeCorporateBatchSettings({ adhocFee: 350, regularFee: 400 }).regularFee).toBe(400);
  });
});

describe('normalizeMatchSimulationSettings', () => {
  it('returns disabled defaults for empty input', () => {
    const s = normalizeMatchSimulationSettings(null);
    expect(s.enabled).toBe(false);
    expect(s.sessions).toHaveLength(1);
    expect(s.sessions[0].days).toEqual([0, 2, 4, 5, 6]); // Sun, Tue, Thu, Fri, Sat
    expect(s.sessions[0].startTime).toBe('07:00');
    expect(s.sessions[0].endTime).toBe('09:00');
  });

  it('normalizes partial session rows', () => {
    const s = normalizeMatchSimulationSettings({
      enabled: true,
      sessions: [{ days: [2, 4], startTime: '20:00', endTime: '22:00', capacity: 12, fee: 350 }],
    });
    expect(s.enabled).toBe(true);
    expect(s.sessions[0].id).toBeTruthy();
    expect(s.sessions[0].capacity).toBe(12);
    expect(s.sessions[0].fee).toBe(350);
    expect(s.sessions[0].enabled).toBe(true);
  });
});

describe('enrollment periods', () => {
  it('parses month and half-month periods', () => {
    expect(parseEnrollmentPeriod('2026-07')).toEqual({ year: 2026, month: 7, half: null });
    expect(parseEnrollmentPeriod('2026-07-H2')).toEqual({ year: 2026, month: 7, half: 'H2' });
    expect(parseEnrollmentPeriod('2026-13')).toBeNull();
    expect(parseEnrollmentPeriod('garbage')).toBeNull();
  });

  it('formats labels', () => {
    expect(formatPeriodLabel('2026-07')).toBe('July 2026');
    expect(formatPeriodLabel('2026-07-H1')).toBe('July 2026 · First Half');
    expect(formatPeriodLabel('2026-07-H2')).toBe('July 2026 · Second Half');
  });

  it('computes overlapping periods for seat counting', () => {
    // A monthly member shares seats with both halves...
    expect(overlappingPeriods('2026-07')).toEqual(['2026-07', '2026-07-H1', '2026-07-H2']);
    // ...but an H1 member only conflicts with monthly + H1.
    expect(overlappingPeriods('2026-07-H1')).toEqual(['2026-07', '2026-07-H1']);
  });

  it('maps a session date to the periods covering it', () => {
    expect(periodsCoveringDate('2026-07-10', 15)).toEqual(['2026-07', '2026-07-H1']);
    expect(periodsCoveringDate('2026-07-16', 15)).toEqual(['2026-07', '2026-07-H2']);
    // Custom split day moves the boundary.
    expect(periodsCoveringDate('2026-07-16', 20)).toEqual(['2026-07', '2026-07-H1']);
  });
});

describe('time helpers', () => {
  it('converts IST wall-clock to the right UTC instant', () => {
    // 07:00 IST = 01:30 UTC
    expect(istDateTimeToUTC('2026-07-08', '07:00').toISOString()).toBe('2026-07-08T01:30:00.000Z');
  });

  it('computes the weekday of an IST calendar date', () => {
    expect(dayOfWeekOf('2026-07-06')).toBe(1); // Monday
    expect(dayOfWeekOf('2026-07-12')).toBe(0); // Sunday
  });
});

describe('listCorporateSessionDates', () => {
  const settings = { days: [1, 3, 5], startTime: '07:00', endTime: '09:00' }; // Mon/Wed/Fri

  it('generates only configured weekdays inside the horizon', () => {
    // now = before any session on 6 July 2026 (a Monday).
    const now = new Date('2026-07-05T12:00:00.000Z');
    const out = listCorporateSessionDates(settings, { fromDate: '2026-07-06', horizonDays: 7, now });
    expect(out.map((o) => o.date)).toEqual(['2026-07-06', '2026-07-08', '2026-07-10']);
    expect(out[0].startTime.toISOString()).toBe('2026-07-06T01:30:00.000Z');
    expect(out.every((o) => [1, 3, 5].includes(o.dayOfWeek))).toBe(true);
  });

  it("keeps today's session even after its start time", () => {
    // 06:00 UTC on 6 July = 11:30 IST — Monday's 7 AM session is over, but
    // today must stay listed and bookable for the rest of the day.
    const now = new Date('2026-07-06T06:00:00.000Z');
    const out = listCorporateSessionDates(settings, { fromDate: '2026-07-06', horizonDays: 7, now });
    expect(out.map((o) => o.date)).toEqual(['2026-07-06', '2026-07-08', '2026-07-10']);
  });

  it('drops dates strictly before today (IST) but keeps today onward', () => {
    // 11:30 IST on Wed 8 July — Mon 6 July is a past date (dropped); Wed 8
    // (today, 7 AM already over) and Fri 10 stay.
    const now = new Date('2026-07-08T06:00:00.000Z');
    const out = listCorporateSessionDates(settings, { fromDate: '2026-07-06', horizonDays: 7, now });
    expect(out.map((o) => o.date)).toEqual(['2026-07-08', '2026-07-10']);
  });

  it('returns nothing when no days configured', () => {
    const out = listCorporateSessionDates(
      { days: [], startTime: '07:00', endTime: '09:00' },
      { fromDate: '2026-07-06', horizonDays: 30, now: new Date('2026-07-01T00:00:00Z') },
    );
    expect(out).toEqual([]);
  });
});

describe('listMatchSimOccurrences', () => {
  it('supports multiple sessions per day and skips disabled ones', () => {
    const settings = {
      enabled: true,
      sessions: [
        { id: 'a', label: 'Morning', days: [2], startTime: '07:00', endTime: '09:00', capacity: 10, fee: 200, coachName: '', enabled: true },
        { id: 'b', label: 'Night', days: [2], startTime: '20:00', endTime: '22:00', capacity: 8, fee: 300, coachName: '', enabled: true },
        { id: 'c', label: 'Off', days: [2], startTime: '10:00', endTime: '12:00', capacity: 8, fee: 300, coachName: '', enabled: false },
      ],
    };
    const now = new Date('2026-07-05T12:00:00.000Z');
    const out = listMatchSimOccurrences(settings, { fromDate: '2026-07-06', horizonDays: 3, now });
    // 7 July 2026 is a Tuesday → two enabled occurrences, sorted by time.
    expect(out.map((o) => `${o.date} ${o.session.id}`)).toEqual(['2026-07-07 a', '2026-07-07 b']);
  });

  it("keeps today's sessions listed even after their start time", () => {
    const settings = {
      enabled: true,
      sessions: [
        { id: 'a', label: 'Morning', days: [2], startTime: '07:00', endTime: '09:00', capacity: 10, fee: 200, coachName: '', enabled: true },
        { id: 'b', label: 'Night', days: [2], startTime: '20:00', endTime: '22:00', capacity: 8, fee: 300, coachName: '', enabled: true },
      ],
    };
    // 11:30 IST on Tue 7 July — the 7 AM session is over, but both of
    // today's sessions must stay bookable for the rest of the day.
    const now = new Date('2026-07-07T06:00:00.000Z');
    const out = listMatchSimOccurrences(settings, { fromDate: '2026-07-07', horizonDays: 1, now });
    expect(out.map((o) => `${o.date} ${o.session.id}`)).toEqual(['2026-07-07 a', '2026-07-07 b']);
  });
});

describe('firstUpcomingSessionInPeriod', () => {
  const settings = {
    days: [1, 3, 5], // Mon/Wed/Fri
    startTime: '07:00',
    endTime: '09:00',
    halfMonth: DEFAULT_CORPORATE_BATCH_SETTINGS.halfMonth,
  };

  it('finds the first session of a future month', () => {
    const now = new Date('2026-07-05T00:00:00.000Z');
    const first = firstUpcomingSessionInPeriod(settings, '2026-08', now);
    // 3 Aug 2026 is the first Monday of August.
    expect(first?.date).toBe('2026-08-03');
  });

  it("keeps today's session as the first even after its start time", () => {
    // 8 July 2026 10:00 IST — Mon 6th is past (skipped), but Wed 8th (7 AM
    // already over) is today and must remain the enrollment's start date.
    const now = new Date('2026-07-08T04:30:00.000Z');
    const first = firstUpcomingSessionInPeriod(settings, '2026-07', now);
    expect(first?.date).toBe('2026-07-08');
  });

  it('respects half boundaries', () => {
    const now = new Date('2026-07-01T00:00:00.000Z');
    const h2 = firstUpcomingSessionInPeriod(settings, '2026-07-H2', now);
    // Second half starts on the 16th; 17 July 2026 is the first Mon/Wed/Fri ≥ 16.
    expect(h2?.date).toBe('2026-07-17');
    const h1 = firstUpcomingSessionInPeriod(settings, '2026-07-H1', now);
    expect(h1?.date).toBe('2026-07-01'); // Wednesday
  });

  it('returns null when the period has no remaining sessions', () => {
    // 1 Aug 2026 (IST) — every July session date is now in the past.
    const now = new Date('2026-08-01T06:00:00.000Z');
    expect(firstUpcomingSessionInPeriod(settings, '2026-07', now)).toBeNull();
  });
});

describe('listMonthKeys', () => {
  it('lists the current month plus the next ones, across year ends', () => {
    expect(listMonthKeys(3, '2026-07-07')).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(listMonthKeys(3, '2026-12-25')).toEqual(['2026-12', '2027-01', '2027-02']);
  });
});
