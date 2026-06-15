import { describe, it, expect } from 'vitest';
import { slotMatchesMembershipAvailability, type AvailabilityWindow } from '../resource-booking';

describe('slotMatchesMembershipAvailability (weekly + effective date range)', () => {
  const weekly: AvailabilityWindow[] = [
    { dayOfWeek: 1, startTime: '09:00', endTime: '11:00' }, // Monday 9–11, no date limit
  ];

  const mondayDate = new Date('2026-06-01T00:00:00.000Z'); // June 1, 2026 is Monday
  const sundayDate = new Date('2026-05-31T00:00:00.000Z'); // May 31, 2026 is Sunday

  it('matches a slot inside the weekday window when unbounded', () => {
    const slot = {
      date: mondayDate,
      startTime: new Date('2026-06-01T09:30:00.000+05:30'),
      endTime: new Date('2026-06-01T10:30:00.000+05:30'),
    };
    expect(slotMatchesMembershipAvailability(slot, weekly)).toBe(true);
  });

  it('fails outside the weekday time window', () => {
    const slot = {
      date: mondayDate,
      startTime: new Date('2026-06-01T14:00:00.000+05:30'),
      endTime: new Date('2026-06-01T15:00:00.000+05:30'),
    };
    expect(slotMatchesMembershipAvailability(slot, weekly)).toBe(false);
  });

  it('fails on a weekday with no configured window', () => {
    const slot = {
      date: sundayDate,
      startTime: new Date('2026-05-31T09:30:00.000+05:30'),
      endTime: new Date('2026-05-31T10:30:00.000+05:30'),
    };
    expect(slotMatchesMembershipAvailability(slot, weekly)).toBe(false);
  });

  it('treats an empty schedule as unavailable', () => {
    const slot = {
      date: mondayDate,
      startTime: new Date('2026-06-01T09:30:00.000+05:30'),
      endTime: new Date('2026-06-01T10:30:00.000+05:30'),
    };
    expect(slotMatchesMembershipAvailability(slot, [])).toBe(false);
  });

  describe('effective date range', () => {
    const ranged: AvailabilityWindow[] = [
      {
        dayOfWeek: 1,
        startTime: '06:00',
        endTime: '09:00',
        effectiveFrom: new Date('2026-06-01T00:00:00.000Z'),
        effectiveTo: new Date('2026-06-30T00:00:00.000Z'),
      },
    ];

    const slotOn = (iso: string) => ({
      date: new Date(`${iso}T00:00:00.000Z`),
      startTime: new Date(`${iso}T06:30:00.000+05:30`),
      endTime: new Date(`${iso}T07:30:00.000+05:30`),
    });

    it('matches a Monday inside the effective range', () => {
      // 2026-06-15 is a Monday, inside 01–30 Jun.
      expect(slotMatchesMembershipAvailability(slotOn('2026-06-15'), ranged)).toBe(true);
    });

    it('matches the inclusive start boundary', () => {
      // 2026-06-01 is a Monday and equals effectiveFrom.
      expect(slotMatchesMembershipAvailability(slotOn('2026-06-01'), ranged)).toBe(true);
    });

    it('matches the inclusive end boundary', () => {
      // 2026-06-29 is the last Monday on/before effectiveTo (30 Jun).
      expect(slotMatchesMembershipAvailability(slotOn('2026-06-29'), ranged)).toBe(true);
    });

    it('fails before the effective range starts', () => {
      // 2026-05-25 is a Monday but before 01 Jun.
      expect(slotMatchesMembershipAvailability(slotOn('2026-05-25'), ranged)).toBe(false);
    });

    it('fails after the effective range ends', () => {
      // 2026-07-06 is a Monday but after 30 Jun.
      expect(slotMatchesMembershipAvailability(slotOn('2026-07-06'), ranged)).toBe(false);
    });

    it('respects an open-ended (from only) range', () => {
      const fromOnly: AvailabilityWindow[] = [
        { dayOfWeek: 1, startTime: '06:00', endTime: '09:00', effectiveFrom: new Date('2026-06-01T00:00:00.000Z') },
      ];
      expect(slotMatchesMembershipAvailability(slotOn('2026-05-25'), fromOnly)).toBe(false);
      expect(slotMatchesMembershipAvailability(slotOn('2026-12-28'), fromOnly)).toBe(true);
    });
  });
});
