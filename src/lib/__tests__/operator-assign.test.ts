import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Operator allocation is driven by availability alone.
 *
 * The old model had three overlapping knobs — an `OPERATOR_SCHEDULE_CONFIG`
 * policy (operator count per weekday + slab), an `OPERATOR_DATE_OVERRIDES`
 * policy, and a per-machine `OperatorAssignment` table with day filters and
 * a day+slab priority matrix on the User row. All of it is gone. What
 * remains is exactly the Ground Staff / Coach / Sidearm model:
 *
 *  1. An operator is on duty for a slot when their OPERATOR membership's
 *     weekly availability covers it. No schedule configured = NOT
 *     available: an operator only becomes eligible for assignment once an
 *     admin has entered a window that covers the slot. (Coaches and
 *     sidearm specialists already work this way; ground staff are the
 *     deliberate exception, being a floor contact rather than an
 *     assignable resource.)
 *  2. An operator serves one booking at a time, so the number of
 *     operator-assisted machine bookings a slot can carry is exactly the
 *     number of operators available for it.
 *  3. Ties are broken by the membership `priority` (1 = first pick), the
 *     same field the Ground Staff tab's up/down arrows write.
 */

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/policy', () => ({
  getPolicyValue: vi.fn(),
  getPolicyJson: vi.fn(),
  getCenterOnlyPolicy: vi.fn(),
  getCenterOnlyPolicyJson: vi.fn(),
  isPolicyEnabled: vi.fn(),
}));

import {
  autoAssignOperator,
  getAvailableOperatorCount,
  getOperatorSlotCapacity,
  loadOperatorRoster,
  operatorIsAvailableForSlot,
  operatorsAvailableForSlot,
  centerOperatorUserWhere,
  canOperateAtCenter,
  type OperatorRosterEntry,
} from '../operatorAssign';

// 2026-07-06 is a Monday. 08:00–08:30 IST == 02:30–03:00 UTC.
const date = new Date('2026-07-06T00:00:00.000Z');
const startTime = new Date('2026-07-06T02:30:00.000Z');
const endTime = new Date('2026-07-06T03:00:00.000Z');
const slot = { date, startTime, endTime };

type Window = {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  effectiveFrom?: Date | null;
  effectiveTo?: Date | null;
};

const op = (
  userId: string,
  priority: number,
  availability: Window[] = [],
): OperatorRosterEntry => ({ userId, priority, availability });

/** Mon 06:00–12:00 — covers the 08:00 slot under test. */
const MORNING: Window = { dayOfWeek: 1, startTime: '06:00', endTime: '12:00' };

/**
 * Minimal stand-in for the Prisma client / transaction surface that
 * operatorAssign touches.
 */
function makeDb(opts: {
  roster?: OperatorRosterEntry[];
  busyOperatorIds?: string[];
  user?: { role: string; memberships: number } | null;
}) {
  const roster = opts.roster ?? [];
  const busy = opts.busyOperatorIds ?? [];
  const calls: { membershipArgs: unknown[]; bookingWhere: unknown[] } = {
    membershipArgs: [],
    bookingWhere: [],
  };

  return {
    centerMembership: {
      findMany: vi.fn(async (args: unknown) => {
        calls.membershipArgs.push(args);
        return roster.map((r) => ({
          userId: r.userId,
          priority: r.priority,
          availability: r.availability,
        }));
      }),
    },
    user: {
      findUnique: vi.fn(async () =>
        opts.user
          ? {
              role: opts.user.role,
              centerMemberships: Array.from({ length: opts.user.memberships }, (_, i) => ({ id: `m${i}` })),
            }
          : null,
      ),
    },
    booking: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        calls.bookingWhere.push(where);
        return busy.map((id) => ({ operatorId: id }));
      }),
    },
    calls,
  };
}

const assign = (db: unknown) =>
  autoAssignOperator({ date, startTime, endTime, tx: db as never, centerId: 'ctr_x' });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('loadOperatorRoster', () => {
  it('reads active OPERATOR memberships at the center, priority first', async () => {
    const db = makeDb({ roster: [op('a', 1), op('b', 2)] });

    const roster = await loadOperatorRoster('ctr_x', db as never);

    expect(roster.map((r) => r.userId)).toEqual(['a', 'b']);
    expect(db.centerMembership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { centerId: 'ctr_x', role: 'OPERATOR', isActive: true },
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      }),
    );
  });
});

describe('operatorIsAvailableForSlot', () => {
  it('treats an operator with no configured schedule as NOT available', () => {
    expect(operatorIsAvailableForSlot(op('a', 1), slot)).toBe(false);
  });

  it('matches the coach / sidearm rule rather than the ground-staff one', () => {
    // Ground staff fall back to "always on the floor" when unscheduled.
    // Operators are an assignable resource, so they do not.
    expect(operatorIsAvailableForSlot(op('a', 1, []), slot)).toBe(false);
    expect(operatorsAvailableForSlot([op('a', 1), op('b', 2)], slot)).toEqual([]);
  });

  it('accepts a slot that fits inside a weekly window', () => {
    expect(operatorIsAvailableForSlot(op('a', 1, [MORNING]), slot)).toBe(true);
  });

  it('rejects a slot on a weekday the operator does not work', () => {
    // Sunday only; the slot under test is a Monday.
    expect(operatorIsAvailableForSlot(op('a', 1, [{ ...MORNING, dayOfWeek: 0 }]), slot)).toBe(false);
  });

  it('rejects a slot that runs past the end of the window', () => {
    expect(
      operatorIsAvailableForSlot(op('a', 1, [{ dayOfWeek: 1, startTime: '06:00', endTime: '08:00' }]), slot),
    ).toBe(false);
  });

  it('honours the window effective date range', () => {
    const expired = { ...MORNING, effectiveTo: new Date('2026-07-05T00:00:00.000Z') };
    const future = { ...MORNING, effectiveFrom: new Date('2026-07-07T00:00:00.000Z') };
    const current = { ...MORNING, effectiveFrom: new Date('2026-07-01T00:00:00.000Z') };

    expect(operatorIsAvailableForSlot(op('a', 1, [expired]), slot)).toBe(false);
    expect(operatorIsAvailableForSlot(op('a', 1, [future]), slot)).toBe(false);
    expect(operatorIsAvailableForSlot(op('a', 1, [current]), slot)).toBe(true);
  });

  it('filters the roster while preserving priority order', () => {
    const roster = [
      op('a', 1, [{ ...MORNING, dayOfWeek: 0 }]), // wrong weekday
      op('b', 2, [MORNING]), // covers the slot
      op('c', 3), // no schedule at all
      op('d', 4, [MORNING]), // covers the slot
    ];
    expect(operatorsAvailableForSlot(roster, slot).map((o) => o.userId)).toEqual(['b', 'd']);
  });
});

describe('getAvailableOperatorCount — capacity comes from availability', () => {
  it('counts only the operators scheduled for the slot', async () => {
    const db = makeDb({
      roster: [op('a', 1, [MORNING]), op('b', 2, [{ ...MORNING, dayOfWeek: 0 }]), op('c', 3, [MORNING])],
    });

    expect(await getAvailableOperatorCount('ctr_x', slot, db as never)).toBe(2);
  });

  it('is 0 when nobody has a schedule configured, however large the roster', async () => {
    const db = makeDb({ roster: [op('a', 1), op('b', 2), op('c', 3), op('d', 4)] });

    expect(await getAvailableOperatorCount('ctr_x', slot, db as never)).toBe(0);
  });

  it('is 0 when the center has no operators at all', async () => {
    const db = makeDb({ roster: [] });
    expect(await getAvailableOperatorCount('ctr_x', slot, db as never)).toBe(0);
  });

  it('is 0 when every operator is off for the slot', async () => {
    const db = makeDb({ roster: [op('a', 1, [{ ...MORNING, dayOfWeek: 0 }])] });
    expect(await getAvailableOperatorCount('ctr_x', slot, db as never)).toBe(0);
  });
});

describe('getOperatorSlotCapacity — one operator, one booking', () => {
  it('subtracts operators already on an overlapping booking', async () => {
    const db = makeDb({
      roster: [op('a', 1, [MORNING]), op('b', 2, [MORNING]), op('c', 3, [MORNING])],
      busyOperatorIds: ['a'],
    });

    const capacity = await getOperatorSlotCapacity({ centerId: 'ctr_x', slot, tx: db as never });

    expect(capacity).toEqual({ onDuty: 3, busy: 1, free: 2, freeOperatorIds: ['b', 'c'] });
  });

  it('reports zero remaining capacity once every operator is booked', async () => {
    const db = makeDb({
      roster: [op('a', 1, [MORNING]), op('b', 2, [MORNING])],
      busyOperatorIds: ['a', 'b'],
    });

    const capacity = await getOperatorSlotCapacity({ centerId: 'ctr_x', slot, tx: db as never });

    expect(capacity.onDuty).toBe(2);
    expect(capacity.free).toBe(0);
    expect(capacity.freeOperatorIds).toEqual([]);
  });

  it('reports no capacity at all when the roster has no schedules', async () => {
    // The whole point of the "unscheduled = unavailable" rule: a roster of
    // three operators with nothing entered yields zero bookable capacity,
    // not three.
    const db = makeDb({ roster: [op('a', 1), op('b', 2), op('c', 3)] });

    const capacity = await getOperatorSlotCapacity({ centerId: 'ctr_x', slot, tx: db as never });

    expect(capacity).toEqual({ onDuty: 0, busy: 0, free: 0, freeOperatorIds: [] });
    expect(db.booking.findMany).not.toHaveBeenCalled();
  });

  it('ignores an off-duty operator who is busy elsewhere', async () => {
    const db = makeDb({
      roster: [op('a', 1, [{ ...MORNING, dayOfWeek: 0 }]), op('b', 2, [MORNING])],
      busyOperatorIds: ['a'],
    });

    const capacity = await getOperatorSlotCapacity({ centerId: 'ctr_x', slot, tx: db as never });

    expect(capacity).toEqual({ onDuty: 1, busy: 0, free: 1, freeOperatorIds: ['b'] });
  });

  it('skips the booking query entirely when nobody is on duty', async () => {
    const db = makeDb({ roster: [op('a', 1, [{ ...MORNING, dayOfWeek: 0 }])] });

    const capacity = await getOperatorSlotCapacity({ centerId: 'ctr_x', slot, tx: db as never });

    expect(capacity.onDuty).toBe(0);
    expect(db.booking.findMany).not.toHaveBeenCalled();
  });

  it('accepts a pre-loaded roster instead of re-querying', async () => {
    const db = makeDb({ roster: [op('zzz', 9)] });

    const capacity = await getOperatorSlotCapacity({
      centerId: 'ctr_x',
      slot,
      tx: db as never,
      roster: [op('a', 1, [MORNING])],
    });

    expect(capacity.freeOperatorIds).toEqual(['a']);
    expect(db.centerMembership.findMany).not.toHaveBeenCalled();
  });

  it('counts overlapping bookings, not just an identical start time', async () => {
    const db = makeDb({ roster: [op('a', 1, [MORNING])] });

    await getOperatorSlotCapacity({ centerId: 'ctr_x', slot, tx: db as never });

    const where = db.calls.bookingWhere[0] as Record<string, unknown>;
    expect(where.startTime).toEqual({ lt: endTime });
    expect(where.endTime).toEqual({ gt: startTime });
    expect(where.centerId).toBe('ctr_x');
    expect(where.status).toBe('BOOKED');
  });
});

describe('autoAssignOperator', () => {
  it('picks the highest-priority operator available for the slot', async () => {
    const db = makeDb({ roster: [op('a', 1, [MORNING]), op('b', 2, [MORNING])] });
    expect(await assign(db)).toBe('a');
  });

  it('skips an operator who is already on an overlapping booking', async () => {
    const db = makeDb({
      roster: [op('a', 1, [MORNING]), op('b', 2, [MORNING])],
      busyOperatorIds: ['a'],
    });
    expect(await assign(db)).toBe('b');
  });

  it('skips an operator with no availability entered, even at priority 1', async () => {
    const db = makeDb({ roster: [op('a', 1), op('b', 2, [MORNING])] });
    expect(await assign(db)).toBe('b');
  });

  it('returns null when no operator has entered any availability', async () => {
    const db = makeDb({ roster: [op('a', 1), op('b', 2), op('c', 3)] });
    expect(await assign(db)).toBeNull();
  });

  it('skips an operator whose schedule does not cover the slot', async () => {
    const db = makeDb({
      roster: [op('a', 1, [{ ...MORNING, dayOfWeek: 0 }]), op('b', 2, [MORNING])],
    });
    expect(await assign(db)).toBe('b');
  });

  it('returns null once the slot is at operator capacity', async () => {
    // Two operators, both already booked in this window — the third
    // machine booking cannot be operator-assisted.
    const db = makeDb({
      roster: [op('a', 1, [MORNING]), op('b', 2, [MORNING])],
      busyOperatorIds: ['a', 'b'],
    });
    expect(await assign(db)).toBeNull();
  });

  it('returns null when the center has no operators', async () => {
    const db = makeDb({ roster: [] });
    expect(await assign(db)).toBeNull();
  });
});

describe('centerOperatorUserWhere', () => {
  it('scopes to active OPERATOR memberships at the center', () => {
    expect(centerOperatorUserWhere('ctr_x')).toEqual({
      centerMemberships: { some: { centerId: 'ctr_x', role: 'OPERATOR', isActive: true } },
    });
  });

  it('matches any center when none is supplied', () => {
    expect(centerOperatorUserWhere(null)).toEqual({
      centerMemberships: { some: { role: 'OPERATOR', isActive: true } },
    });
  });
});

describe('canOperateAtCenter — the manual-assign guard', () => {
  it('accepts a membership-only operator whose User.role is plain USER', async () => {
    const db = makeDb({ user: { role: 'USER', memberships: 1 } });
    expect(await canOperateAtCenter('raj', 'ctr_x', db as never)).toBe(true);
  });

  it('still accepts a legacy global OPERATOR with no membership row', async () => {
    const db = makeDb({ user: { role: 'OPERATOR', memberships: 0 } });
    expect(await canOperateAtCenter('legacy', 'ctr_x', db as never)).toBe(true);
  });

  it('accepts an ADMIN standing in for an operator', async () => {
    const db = makeDb({ user: { role: 'ADMIN', memberships: 0 } });
    expect(await canOperateAtCenter('boss', 'ctr_x', db as never)).toBe(true);
  });

  it('rejects a plain user with no membership at this center', async () => {
    const db = makeDb({ user: { role: 'USER', memberships: 0 } });
    expect(await canOperateAtCenter('nobody', 'ctr_x', db as never)).toBe(false);
  });

  it('rejects an unknown user', async () => {
    const db = makeDb({ user: null });
    expect(await canOperateAtCenter('ghost', 'ctr_x', db as never)).toBe(false);
  });
});
