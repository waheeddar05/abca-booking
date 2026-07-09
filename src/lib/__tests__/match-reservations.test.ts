import { describe, it, expect } from 'vitest';
import {
  resolveWicketsHeld,
  computeReservedByPitchForSlot,
  computeSlotAvailability,
  type PitchReservationWindow,
} from '../resource-booking';

// ── Resource fixtures ────────────────────────────────────────────────
// 3 indoor Astro nets, 2 cement wickets, 2 natural turf wickets.
const resources = [
  { id: 'net1', name: 'Net 1', type: 'NET', category: 'INDOOR', capacity: 1, isActive: true, displayOrder: 1 },
  { id: 'net2', name: 'Net 2', type: 'NET', category: 'INDOOR', capacity: 1, isActive: true, displayOrder: 2 },
  { id: 'net3', name: 'Net 3', type: 'NET', category: 'INDOOR', capacity: 1, isActive: true, displayOrder: 3 },
  { id: 'cem1', name: 'Cement 1', type: 'CEMENT_WICKET', category: 'OUTDOOR', capacity: 1, isActive: true, displayOrder: 4 },
  { id: 'cem2', name: 'Cement 2', type: 'CEMENT_WICKET', category: 'OUTDOOR', capacity: 1, isActive: true, displayOrder: 5 },
  { id: 'nat1', name: 'Natural 1', type: 'TURF_WICKET', category: 'OUTDOOR', capacity: 1, isActive: true, displayOrder: 6 },
  { id: 'nat2', name: 'Natural 2', type: 'TURF_WICKET', category: 'OUTDOOR', capacity: 1, isActive: true, displayOrder: 7 },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
] as any[];

const emptyOccupancy = () => ({
  resourceLoad: new Map<string, number>(),
  claimedResourceIds: new Set<string>(),
  busyCoachIds: new Set<string>(),
  busyStaffIds: new Set<string>(),
  busyMachineIds: new Set<string>(),
  hasFullCourtBooking: false,
});

// A slot inside a Mon–Fri 07:00–09:00 IST window. 2026-07-06 is a Monday;
// 08:00–08:30 IST == 02:30–03:00 UTC.
const slotInWindow = {
  date: new Date('2026-07-06T00:00:00.000Z'),
  startTime: new Date('2026-07-06T02:30:00.000Z'),
  endTime: new Date('2026-07-06T03:00:00.000Z'),
};
// Outside the time window (11:00 IST == 05:30 UTC).
const slotOutsideWindow = {
  date: new Date('2026-07-06T00:00:00.000Z'),
  startTime: new Date('2026-07-06T05:30:00.000Z'),
  endTime: new Date('2026-07-06T06:00:00.000Z'),
};
// A Sunday slot inside the time-of-day window (2026-07-05 is Sunday).
const sundaySlotInTime = {
  date: new Date('2026-07-05T00:00:00.000Z'),
  startTime: new Date('2026-07-05T02:30:00.000Z'),
  endTime: new Date('2026-07-05T03:00:00.000Z'),
};

const win = (over: Partial<PitchReservationWindow>): PitchReservationWindow => ({
  enabled: true,
  days: [1, 2, 3, 4, 5],
  startTime: '07:00',
  endTime: '09:00',
  wicketsHeld: {},
  ...over,
});

describe('resolveWicketsHeld', () => {
  it('prefers per-pitch wicketsHeld', () => {
    expect(resolveWicketsHeld(win({ wicketsHeld: { ASTRO: 1, NATURAL: 2 } }))).toEqual({ ASTRO: 1, CEMENT: 0, NATURAL: 2 });
  });

  it('folds legacy netsConsumed into ASTRO when wicketsHeld is empty', () => {
    expect(resolveWicketsHeld({ wicketsHeld: {}, netsConsumed: 3 })).toEqual({ ASTRO: 3, CEMENT: 0, NATURAL: 0 });
  });

  it('wicketsHeld wins over netsConsumed when both present', () => {
    expect(resolveWicketsHeld({ wicketsHeld: { CEMENT: 2 }, netsConsumed: 5 })).toEqual({ ASTRO: 0, CEMENT: 2, NATURAL: 0 });
  });

  it('clamps negatives / floors fractions', () => {
    expect(resolveWicketsHeld({ wicketsHeld: { ASTRO: -1, NATURAL: 1.9 } })).toEqual({ ASTRO: 0, CEMENT: 0, NATURAL: 1 });
  });
});

describe('computeReservedByPitchForSlot', () => {
  it('shares the hold across corporate batch + match-sim (max per pitch, not sum)', () => {
    const corporate = win({ wicketsHeld: { ASTRO: 1, NATURAL: 1 } });
    const session = win({ wicketsHeld: { ASTRO: 1, CEMENT: 2 } });
    // Per pitch: max(ASTRO 1,1)=1, max(CEMENT 0,2)=2, max(NATURAL 1,0)=1.
    expect(computeReservedByPitchForSlot(corporate, [session], slotInWindow)).toEqual({
      ASTRO: 1,
      CEMENT: 2,
      NATURAL: 1,
    });
  });

  it('both sessions enabled with default holds → one net total, not two', () => {
    // Neither carries an explicit hold, so each defaults to one Astro net.
    // Sharing means the slot holds ONE net, leaving the rest bookable —
    // this is the over-blocking fix (1 + 1 must not become 2).
    const corporate = win({ wicketsHeld: {} });
    const session = win({ wicketsHeld: {} });
    expect(computeReservedByPitchForSlot(corporate, [session], slotInWindow)).toEqual({
      ASTRO: 1,
      CEMENT: 0,
      NATURAL: 0,
    });
  });

  it('a disabled window holds nothing', () => {
    expect(computeReservedByPitchForSlot(win({ enabled: false, wicketsHeld: { ASTRO: 2 } }), [], slotInWindow))
      .toEqual({ ASTRO: 0, CEMENT: 0, NATURAL: 0 });
  });

  it('holds nothing outside the time window', () => {
    expect(computeReservedByPitchForSlot(win({ wicketsHeld: { ASTRO: 2 } }), [], slotOutsideWindow))
      .toEqual({ ASTRO: 0, CEMENT: 0, NATURAL: 0 });
  });

  it('holds nothing on a day not in the config', () => {
    expect(computeReservedByPitchForSlot(win({ wicketsHeld: { ASTRO: 2 } }), [], sundaySlotInTime))
      .toEqual({ ASTRO: 0, CEMENT: 0, NATURAL: 0 });
  });

  it('a match-sim session with its own day/window is honoured independently', () => {
    // Corporate batch off; a Sunday-only match-sim session holds naturals.
    const session = win({ days: [0], wicketsHeld: { NATURAL: 1 } });
    expect(computeReservedByPitchForSlot(null, [session], sundaySlotInTime))
      .toEqual({ ASTRO: 0, CEMENT: 0, NATURAL: 1 });
    // Same session doesn't apply on Monday.
    expect(computeReservedByPitchForSlot(null, [session], slotInWindow))
      .toEqual({ ASTRO: 0, CEMENT: 0, NATURAL: 0 });
  });

  it('supports legacy netsConsumed corporate configs (astro)', () => {
    expect(computeReservedByPitchForSlot(win({ wicketsHeld: {}, netsConsumed: 2 }), [], slotInWindow))
      .toEqual({ ASTRO: 2, CEMENT: 0, NATURAL: 0 });
  });
});

describe('computeSlotAvailability — per-pitch reservations', () => {
  it('reduces each pitch pool by the reserved count', () => {
    const avail = computeSlotAvailability({
      resources, coaches: [], staff: [], occupancy: emptyOccupancy(),
      reservedByPitch: { ASTRO: 1, CEMENT: 1, NATURAL: 2 },
    });
    expect(avail.freeByPitch.ASTRO).toHaveLength(2); // 3 - 1
    expect(avail.freeByPitch.CEMENT).toHaveLength(1); // 2 - 1
    expect(avail.freeByPitch.NATURAL).toHaveLength(0); // 2 - 2
    expect(avail.reservedByPitch).toEqual({ ASTRO: 1, CEMENT: 1, NATURAL: 2 });
    expect(avail.corporateBatchNetsHeld).toBe(4);
  });

  it('never holds more than the pool has', () => {
    const avail = computeSlotAvailability({
      resources, coaches: [], staff: [], occupancy: emptyOccupancy(),
      reservedByPitch: { NATURAL: 99 },
    });
    expect(avail.freeByPitch.NATURAL).toHaveLength(0);
    expect(avail.reservedByPitch.NATURAL).toBe(2); // capped at pool size
  });

  it('blocks full court when astro wickets are held, not for cement-only', () => {
    const held = computeSlotAvailability({
      resources, coaches: [], staff: [], occupancy: emptyOccupancy(),
      reservedByPitch: { ASTRO: 1 },
    });
    expect(held.fullCourtAvailable).toBe(false);

    const free = computeSlotAvailability({
      resources, coaches: [], staff: [], occupancy: emptyOccupancy(),
      reservedByPitch: { CEMENT: 1 },
    });
    expect(free.fullCourtAvailable).toBe(true);
  });

  it('back-compat: legacy batchNets folds into the astro pool', () => {
    const avail = computeSlotAvailability({
      resources, coaches: [], staff: [], occupancy: emptyOccupancy(),
      batchNets: 2,
    });
    expect(avail.freeByPitch.ASTRO).toHaveLength(1); // 3 - 2
    expect(avail.reservedByPitch.ASTRO).toBe(2);
    expect(avail.fullCourtAvailable).toBe(false);
  });
});
