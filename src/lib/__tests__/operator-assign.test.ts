import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Regression guards for "the operator is unassigned on most bookings".
 *
 * Two independent causes, both reproduced here:
 *
 *  1. `getOperatorCount` is the per-slot operator *capacity*. It used to
 *     fall back to a hard-coded 1 whenever a center had no
 *     OPERATOR_SCHEDULE_CONFIG / NUMBER_OF_OPERATORS policy — which is
 *     the state of every center that never opened Admin → Operators →
 *     Schedule. With 1 seat, only the first booking in a time slot could
 *     receive an operator; every other net booked at the same time came
 *     out with `operatorId = null`. It now defaults to the roster size.
 *
 *  2. `autoAssignOperator` only ever looked at OperatorAssignment rows
 *     via the legacy `machineId` enum, so RESOURCE_BASED centers (which
 *     reference machines by `machineRowId`) silently ignored every
 *     per-machine assignment and its weekday `days` filter.
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
} from '../operatorAssign';
import type { TimeSlabConfig } from '../pricing';

const timeSlabs: TimeSlabConfig = {
  morning: { start: '06:00', end: '12:00' },
  evening: { start: '15:00', end: '22:00' },
} as unknown as TimeSlabConfig;

// 2026-07-06 is a Monday. 08:00 IST == 02:30 UTC.
const date = new Date('2026-07-06T00:00:00.000Z');
const startTime = new Date('2026-07-06T02:30:00.000Z');

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
 * operatorAssign touches.
 */
function makeDb(opts: {
  roster?: Op[];
  assignments?: { userId: string; machineId?: string | null; machineRowId?: string | null; days: number[]; op: Op }[];
  busyOperatorIds?: string[];
}) {
  const roster = opts.roster ?? [];
  const assignments = opts.assignments ?? [];
  const busy = opts.busyOperatorIds ?? [];
  const calls: { operatorAssignmentWhere: unknown[] } = { operatorAssignmentWhere: [] };

  const db = {
    centerMembership: {
      count: vi.fn(async () => roster.length),
      findMany: vi.fn(async () => roster.map((u) => ({ user: u }))),
    },
    user: {
      count: vi.fn(async () => roster.length),
      findMany: vi.fn(async () => roster),
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
            user: { ...a.op, role: 'USER', centerMemberships: [{ id: `m_${a.userId}` }] },
          }));
      }),
    },
    booking: {
      findMany: vi.fn(async () => busy.map((id) => ({ operatorId: id }))),
    },
    calls,
  };
  return db;
}

beforeEach(() => {
  getPolicyValueMock.mockReset();
  getPolicyValueMock.mockResolvedValue(null);
  invalidateOperatorRoster();
});

describe('getOperatorCount — unconfigured center', () => {
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

  it('treats an empty schedule config as unset and falls through to the roster', async () => {
    getPolicyValueMock.mockImplementation(async (key: string) =>
      key === 'OPERATOR_SCHEDULE_CONFIG' ? JSON.stringify({ schedule: [] }) : null,
    );
    const db = makeDb({ roster: [op('a', 1), op('b', 2), op('c', 3)] });

    expect(await getOperatorCount(date, startTime, timeSlabs, 'ctr_x', db as never)).toBe(3);
  });
});

describe('getOperatorCount — configured center', () => {
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

describe('autoAssignOperator — resource-based centers', () => {
  it('consults per-machine assignments by machineRowId', async () => {
    const db = makeDb({
      roster: [op('a', 1), op('b', 2)],
      assignments: [{ userId: 'b', machineRowId: 'mrow_1', days: [], op: op('b', 2) }],
    });

    const picked = await autoAssignOperator(
      date, startTime, db as never, null, 'morning', 'ctr_x', 'mrow_1',
    );

    // 'b' is lower priority overall but explicitly assigned to this machine.
    expect(picked).toBe('b');
    expect(db.calls.operatorAssignmentWhere).toContainEqual({
      machineRowId: 'mrow_1',
      centerId: 'ctr_x',
    });
  });

  it("skips a machine assignment whose weekday filter excludes today's day", async () => {
    const db = makeDb({
      roster: [op('a', 1), op('b', 2)],
      // days [0] = Sunday only; the slot under test is a Monday.
      assignments: [{ userId: 'b', machineRowId: 'mrow_1', days: [0], op: op('b', 2) }],
    });

    const picked = await autoAssignOperator(
      date, startTime, db as never, null, 'morning', 'ctr_x', 'mrow_1',
    );

    expect(picked).toBe('a');
  });

  it('widens to the rest of the roster when the assigned operator is busy', async () => {
    const db = makeDb({
      roster: [op('a', 1), op('b', 2)],
      assignments: [{ userId: 'b', machineRowId: 'mrow_1', days: [], op: op('b', 2) }],
      busyOperatorIds: ['b'],
    });

    const picked = await autoAssignOperator(
      date, startTime, db as never, null, 'morning', 'ctr_x', 'mrow_1',
    );

    // Previously this double-booked 'b' while 'a' sat idle.
    expect(picked).toBe('a');
  });

  it('falls back to the roster when the machine has no assignments', async () => {
    const db = makeDb({ roster: [op('a', 1), op('b', 2)] });

    const picked = await autoAssignOperator(
      date, startTime, db as never, null, 'morning', 'ctr_x', 'mrow_9',
    );

    expect(picked).toBe('a');
  });

  it('picks the next free operator rather than the busy top-priority one', async () => {
    const db = makeDb({ roster: [op('a', 1), op('b', 2), op('c', 3)], busyOperatorIds: ['a'] });

    const picked = await autoAssignOperator(
      date, startTime, db as never, null, 'morning', 'ctr_x', null,
    );

    expect(picked).toBe('b');
  });

  it('only excludes inactive memberships from the roster', async () => {
    const db = makeDb({ roster: [op('a', 1)] });

    await autoAssignOperator(date, startTime, db as never, null, 'morning', 'ctr_x', null);

    expect(db.centerMembership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { centerId: 'ctr_x', role: 'OPERATOR', isActive: true },
      }),
    );
  });

  it('returns null when the center has no operators', async () => {
    const db = makeDb({ roster: [] });

    const picked = await autoAssignOperator(
      date, startTime, db as never, null, 'morning', 'ctr_x', 'mrow_1',
    );

    expect(picked).toBeNull();
  });
});
