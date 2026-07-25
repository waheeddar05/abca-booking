import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Regression guards for "bookings come out with no operator assigned"
 * and "assigning an operator by hand says 'user is not an operator'".
 *
 * Both symptoms had the same underlying shape: the codebase answered
 * "who is an operator at this center?" in more than one way, and the
 * per-slot operator count was used as a booking capacity rather than as
 * a staffing level.
 *
 *  1. `getOperatorCount` is the number of operators ON DUTY. The booking
 *     engine must treat only 0 specially. Using it as a cap meant the
 *     first booking of a 07:00 slot took the only "seat" and every other
 *     net booked at 07:00 was written with operatorId = null.
 *  2. `autoAssignOperator` must never return null while the center has a
 *     roster — a slot with more bookings than operators gives someone a
 *     second booking rather than leaving the row unassigned.
 *  3. The candidate pool is active OPERATOR CenterMemberships, the same
 *     population the admin dropdown and the roster count use, so the
 *     auto-assigner can't pick somebody the admin UI cannot render.
 */

const getPolicyValueMock = vi.fn();

vi.mock('@/lib/policy', () => ({
  getPolicyValue: (key: string, centerId: string | null) => getPolicyValueMock(key, centerId),
}));

vi.mock('@/lib/prisma', () => ({ prisma: {} }));

import {
  autoAssignOperator,
  getOperatorCount,
  invalidateOperatorRoster,
  centerOperatorUserWhere,
  canOperateAtCenter,
} from '../operatorAssign';
import type { TimeSlabConfig } from '../pricing';

const timeSlabs: TimeSlabConfig = {
  morning: { start: '06:00', end: '12:00' },
  evening: { start: '15:00', end: '22:00' },
} as unknown as TimeSlabConfig;

// 2026-07-06 is a Monday. 08:00 IST == 02:30 UTC.
const date = new Date('2026-07-06T00:00:00.000Z');
const startTime = new Date('2026-07-06T02:30:00.000Z');
const endTime = new Date('2026-07-06T03:00:00.000Z');

type Op = {
  id: string;
  operatorPriority: number;
  operatorMorningPriority: number;
  operatorEveningPriority: number;
  operatorDayPriorities: Record<string, { morning: number; evening: number }> | null;
};

const op = (id: string, priority: number): Op => ({
  id,
  operatorPriority: priority,
  operatorMorningPriority: priority,
  operatorEveningPriority: priority,
  operatorDayPriorities: null,
});

/**
 * Minimal stand-in for the Prisma client / transaction surface that
 * operatorAssign touches. `busyOperatorIds` may repeat an id to model an
 * operator already carrying more than one booking in the slot.
 */
function makeDb(opts: {
  roster?: Op[];
  /** Machine assignments. `membership` false models a stale row for a non-member. */
  assignments?: { machineRowId?: string | null; machineId?: string | null; days: number[]; op: Op; membership?: boolean }[];
  busyOperatorIds?: string[];
  user?: { role: string; memberships: number } | null;
}) {
  const roster = opts.roster ?? [];
  const assignments = opts.assignments ?? [];
  const busy = opts.busyOperatorIds ?? [];
  const calls: { operatorAssignmentWhere: unknown[]; bookingWhere: unknown[] } = {
    operatorAssignmentWhere: [],
    bookingWhere: [],
  };

  return {
    centerMembership: {
      count: vi.fn(async () => roster.length),
      findMany: vi.fn(async () => roster.map((u) => ({ user: u }))),
      findFirst: vi.fn(async () => null),
    },
    user: {
      count: vi.fn(async () => roster.length),
      findMany: vi.fn(async () => roster),
      findUnique: vi.fn(async () =>
        opts.user
          ? {
              role: opts.user.role,
              centerMemberships: Array.from({ length: opts.user.memberships }, (_, i) => ({ id: `m${i}` })),
            }
          : null,
      ),
    },
    operatorAssignment: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        calls.operatorAssignmentWhere.push(where);
        return assignments
          .filter((a) =>
            where.machineRowId !== undefined
              ? a.machineRowId === where.machineRowId
              : a.machineId === where.machineId,
          )
          .map((a) => ({
            days: a.days,
            user: {
              ...a.op,
              role: 'USER',
              centerMemberships: a.membership === false ? [] : [{ id: `m_${a.op.id}` }],
            },
          }));
      }),
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

const assign = (db: unknown, over: Record<string, unknown> = {}) =>
  autoAssignOperator({
    date,
    startTime,
    endTime,
    tx: db as never,
    timeSlab: 'morning',
    centerId: 'ctr_x',
    ...over,
  });

beforeEach(() => {
  getPolicyValueMock.mockReset();
  getPolicyValueMock.mockResolvedValue(null);
  invalidateOperatorRoster();
});

describe('getOperatorCount — on-duty staffing level', () => {
  it('defaults to the size of the center roster, not 1', async () => {
    const db = makeDb({ roster: [op('a', 1), op('b', 2), op('c', 3), op('d', 4)] });

    const count = await getOperatorCount(date, startTime, timeSlabs, 'ctr_x', db as never);

    expect(count).toBe(4);
    expect(db.centerMembership.count).toHaveBeenCalledWith({
      where: { centerId: 'ctr_x', role: 'OPERATOR', isActive: true },
    });
  });

  it('returns 0 when the center has no operators at all', async () => {
    const db = makeDb({ roster: [] });
    expect(await getOperatorCount(date, startTime, timeSlabs, 'ctr_x', db as never)).toBe(0);
  });

  it('does not cache a zero roster — a first operator takes effect immediately', async () => {
    const empty = makeDb({ roster: [] });
    expect(await getOperatorCount(date, startTime, timeSlabs, 'ctr_x', empty as never)).toBe(0);
    // Same center, no explicit invalidation, roster now has someone.
    const staffed = makeDb({ roster: [op('a', 1)] });
    expect(await getOperatorCount(date, startTime, timeSlabs, 'ctr_x', staffed as never)).toBe(1);
  });

  it('treats an empty schedule config as unset and falls through to the roster', async () => {
    getPolicyValueMock.mockImplementation(async (key: string) =>
      key === 'OPERATOR_SCHEDULE_CONFIG' ? JSON.stringify({ schedule: [] }) : null,
    );
    const db = makeDb({ roster: [op('a', 1), op('b', 2), op('c', 3)] });

    expect(await getOperatorCount(date, startTime, timeSlabs, 'ctr_x', db as never)).toBe(3);
  });

  it('honours an explicit schedule default over the roster size', async () => {
    getPolicyValueMock.mockImplementation(async (key: string) =>
      key === 'OPERATOR_SCHEDULE_CONFIG' ? JSON.stringify({ default: 2, schedule: [] }) : null,
    );
    const db = makeDb({ roster: [op('a', 1), op('b', 2), op('c', 3), op('d', 4)] });

    expect(await getOperatorCount(date, startTime, timeSlabs, 'ctr_x', db as never)).toBe(2);
  });

  it('honours a day+slab entry over the default', async () => {
    getPolicyValueMock.mockImplementation(async (key: string) =>
      key === 'OPERATOR_SCHEDULE_CONFIG'
        ? JSON.stringify({ default: 2, schedule: [{ days: [1], slab: 'morning', count: 5 }] })
        : null,
    );
    const db = makeDb({ roster: [op('a', 1)] });

    expect(await getOperatorCount(date, startTime, timeSlabs, 'ctr_x', db as never)).toBe(5);
  });

  it('still allows an explicit zero ("no operator" mode)', async () => {
    getPolicyValueMock.mockImplementation(async (key: string) =>
      key === 'OPERATOR_SCHEDULE_CONFIG' ? JSON.stringify({ default: 0, schedule: [] }) : null,
    );
    const db = makeDb({ roster: [op('a', 1), op('b', 2)] });

    expect(await getOperatorCount(date, startTime, timeSlabs, 'ctr_x', db as never)).toBe(0);
  });

  it('date overrides still win over everything else', async () => {
    getPolicyValueMock.mockImplementation(async (key: string) => {
      if (key === 'OPERATOR_DATE_OVERRIDES') {
        return JSON.stringify([{ from: '2026-07-06', to: '2026-07-06', morning: 0, evening: 3 }]);
      }
      return key === 'OPERATOR_SCHEDULE_CONFIG' ? JSON.stringify({ default: 4, schedule: [] }) : null;
    });
    const db = makeDb({ roster: [op('a', 1), op('b', 2)] });

    expect(await getOperatorCount(date, startTime, timeSlabs, 'ctr_x', db as never)).toBe(0);
  });

  it('honours the legacy NUMBER_OF_OPERATORS policy', async () => {
    getPolicyValueMock.mockImplementation(async (key: string) =>
      key === 'NUMBER_OF_OPERATORS' ? '3' : null,
    );
    const db = makeDb({ roster: [op('a', 1), op('b', 2), op('c', 3), op('d', 4), op('e', 5)] });

    expect(await getOperatorCount(date, startTime, timeSlabs, 'ctr_x', db as never)).toBe(3);
  });
});

describe('autoAssignOperator — always names someone when a roster exists', () => {
  it('assigns the single operator even when they already have a booking in this slot', async () => {
    // The reported bug: one operator, several nets. Booking #2 at 07:00
    // used to come out unassigned.
    const db = makeDb({ roster: [op('a', 1)], busyOperatorIds: ['a'] });

    expect(await assign(db)).toBe('a');
  });

  it('spreads load — picks the operator with the fewest bookings in the slot', async () => {
    const db = makeDb({
      roster: [op('a', 1), op('b', 2)],
      // 'a' is top priority but already covering two bookings.
      busyOperatorIds: ['a', 'a'],
    });

    expect(await assign(db)).toBe('b');
  });

  it('prefers a free operator over a busy higher-priority one', async () => {
    const db = makeDb({ roster: [op('a', 1), op('b', 2), op('c', 3)], busyOperatorIds: ['a'] });

    expect(await assign(db)).toBe('b');
  });

  it('counts overlapping bookings, not just an identical start time', async () => {
    const db = makeDb({ roster: [op('a', 1)] });
    await assign(db);

    const where = db.calls.bookingWhere[0] as Record<string, unknown>;
    expect(where.startTime).toEqual({ lt: endTime });
    expect(where.endTime).toEqual({ gt: startTime });
  });

  it('returns null only when the center has no operators', async () => {
    const db = makeDb({ roster: [] });
    expect(await assign(db, { machineRowId: 'mrow_1' })).toBeNull();
  });
});

describe('autoAssignOperator — candidate pool', () => {
  it('consults per-machine assignments by machineRowId', async () => {
    const db = makeDb({
      roster: [op('a', 1), op('b', 2)],
      assignments: [{ machineRowId: 'mrow_1', days: [], op: op('b', 2) }],
    });

    // 'b' is lower priority overall but explicitly assigned to this machine.
    expect(await assign(db, { machineRowId: 'mrow_1' })).toBe('b');
    expect(db.calls.operatorAssignmentWhere).toContainEqual({
      machineRowId: 'mrow_1',
      centerId: 'ctr_x',
    });
  });

  it("skips a machine assignment whose weekday filter excludes today's day", async () => {
    const db = makeDb({
      roster: [op('a', 1), op('b', 2)],
      // days [0] = Sunday only; the slot under test is a Monday.
      assignments: [{ machineRowId: 'mrow_1', days: [0], op: op('b', 2) }],
    });

    expect(await assign(db, { machineRowId: 'mrow_1' })).toBe('a');
  });

  it('ignores a machine assignment for someone with no active membership', async () => {
    // Otherwise the auto-assigner picks a person the membership-scoped
    // admin dropdown cannot render, and the booking reads "Unassigned".
    const db = makeDb({
      roster: [op('a', 1)],
      assignments: [{ machineRowId: 'mrow_1', days: [], op: op('ghost', 1), membership: false }],
    });

    expect(await assign(db, { machineRowId: 'mrow_1' })).toBe('a');
  });

  it('widens to the rest of the roster when the assigned operator is busier', async () => {
    const db = makeDb({
      roster: [op('a', 1), op('b', 2)],
      assignments: [{ machineRowId: 'mrow_1', days: [], op: op('b', 2) }],
      busyOperatorIds: ['b'],
    });

    expect(await assign(db, { machineRowId: 'mrow_1' })).toBe('a');
  });

  it('draws the roster from active OPERATOR memberships only', async () => {
    const db = makeDb({ roster: [op('a', 1)] });

    await assign(db);

    expect(db.centerMembership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { centerId: 'ctr_x', role: 'OPERATOR', isActive: true },
      }),
    );
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
    // This is the exact case that returned "User is not an operator".
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
