import { describe, it, expect } from 'vitest';
import { slotMatchesMembershipAvailability, type AvailabilityWindow, type DateAvailabilityWindow } from '../resource-booking';

describe('slotMatchesMembershipAvailability', () => {
  const weekly: AvailabilityWindow[] = [
    { dayOfWeek: 1, startTime: '09:00', endTime: '11:00' }, // Monday 9-11
  ];

  const mondayDate = new Date('2026-06-01T00:00:00.000Z'); // June 1, 2026 is Monday
  const sundayDate = new Date('2026-05-31T00:00:00.000Z'); // May 31, 2026 is Sunday

  it('matches weekly schedule when no date ranges exist', () => {
    const slot = {
      date: mondayDate,
      startTime: new Date('2026-06-01T09:30:00.000+05:30'),
      endTime: new Date('2026-06-01T10:30:00.000+05:30'),
    };
    expect(slotMatchesMembershipAvailability(slot, weekly, [])).toBe(true);
  });

  it('fails when outside weekly schedule and no date ranges exist', () => {
    const slot = {
      date: mondayDate,
      startTime: new Date('2026-06-01T14:00:00.000+05:30'),
      endTime: new Date('2026-06-01T15:00:00.000+05:30'),
    };
    expect(slotMatchesMembershipAvailability(slot, weekly, [])).toBe(false);
  });

  it('matches date range when no weekly schedule exists', () => {
    const dateRanges: DateAvailabilityWindow[] = [
      { fromDate: sundayDate, toDate: sundayDate, startTime: '10:00', endTime: '12:00' },
    ];
    const slot = {
      date: sundayDate,
      startTime: new Date('2026-05-31T10:30:00.000+05:30'),
      endTime: new Date('2026-05-31T11:30:00.000+05:30'),
    };
    expect(slotMatchesMembershipAvailability(slot, [], dateRanges)).toBe(true);
  });

  it('uses OVERRIDE logic: date range trumps weekly schedule for that date', () => {
    const dateRanges: DateAvailabilityWindow[] = [
      { fromDate: mondayDate, toDate: mondayDate, startTime: '14:00', endTime: '16:00' },
    ];
    
    // Slot in weekly window (9-11) - should now be FALSE because dateRange exists for this date
    const slot1 = {
      date: mondayDate,
      startTime: new Date('2026-06-01T09:30:00.000+05:30'),
      endTime: new Date('2026-06-01T10:30:00.000+05:30'),
    };
    
    // Slot in date range window (14-16) - should be TRUE
    const slot2 = {
      date: mondayDate,
      startTime: new Date('2026-06-01T14:30:00.000+05:30'),
      endTime: new Date('2026-06-01T15:30:00.000+05:30'),
    };

    expect(slotMatchesMembershipAvailability(slot1, weekly, dateRanges)).toBe(false);
    expect(slotMatchesMembershipAvailability(slot2, weekly, dateRanges)).toBe(true);
  });

  it('still falls back to weekly for other dates', () => {
    const nextMonday = new Date('2026-06-08T00:00:00.000Z');
    const dateRanges: DateAvailabilityWindow[] = [
      { fromDate: mondayDate, toDate: mondayDate, startTime: '14:00', endTime: '16:00' },
    ];

    const slot = {
      date: nextMonday,
      startTime: new Date('2026-06-08T09:30:00.000+05:30'),
      endTime: new Date('2026-06-08T10:30:00.000+05:30'),
    };

    expect(slotMatchesMembershipAvailability(slot, weekly, dateRanges)).toBe(true);
  });
});
