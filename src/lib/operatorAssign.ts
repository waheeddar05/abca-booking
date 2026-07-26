import { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from './prisma';
import {
  slotMatchesMembershipAvailability,
  type AvailabilityWindow,
  type BookableSlotWindow,
} from './resource-booking';

type PrismaTransaction = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;
type Db = PrismaTransaction | typeof defaultPrisma;

// ─── "Operator at this center" — the single definition ────
//
// This codebase used to answer "is X an operator here?" three different
// ways: the global `User.role` column, an active
// `CenterMembership(role='OPERATOR')`, and (in the machine-assignment
// path) either of the two. Those answers disagree, which is what
// produced BOTH reported symptoms:
//
//   - The admin bookings dropdown is built from memberships while the
//     save guard read `User.role`, so an operator granted through the
//     center Members tab was listed and then rejected with
//     "User is not an operator".
//   - The auto-assigner could pick a `User.role`-only operator whom the
//     membership-scoped dropdown cannot render, so the row displayed as
//     "Unassigned" even though `operatorId` was set.
//
// One definition from here on: an **active OPERATOR CenterMembership at
// that center**. Every operator surface — picker, roster count, admin
// dropdown, stats, and the manual-assign guard — resolves through this.
// (The multi-center migration backfilled a membership for every legacy
// `User.role='OPERATOR'` user, so nothing is stranded by narrowing to
// memberships.)

/** Prisma `User.where` fragment selecting this center's operators. */
export function centerOperatorUserWhere(centerId: string | null) {
  return centerId
    ? { centerMemberships: { some: { centerId, role: 'OPERATOR' as const, isActive: true } } }
    : { centerMemberships: { some: { role: 'OPERATOR' as const, isActive: true } } };
}

/**
 * Can this user be recorded as the operator on a booking at this center?
 *
 * Accepts an active OPERATOR **or ADMIN** membership at the booking's own
 * center (admins stand in for operators at small centers), and still
 * honours the legacy global `User.role` so no previously-working
 * assignment regresses.
 */
export async function canOperateAtCenter(
  userId: string,
  centerId: string,
  db: Db = defaultPrisma,
): Promise<boolean> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      centerMemberships: {
        where: { centerId, role: { in: ['OPERATOR', 'ADMIN'] }, isActive: true },
        select: { id: true },
      },
    },
  });
  if (!user) return false;
  if ((user.centerMemberships?.length ?? 0) > 0) return true;
  return user.role === 'OPERATOR' || user.role === 'ADMIN';
}

// ─── Operator availability ───────────────────────────────
//
// Operators are staffed exactly like Ground Staff / Coaches / Sidearm
// Specialists: each OPERATOR `CenterMembership` carries a weekly
// availability schedule (`MembershipAvailability` rows, with an optional
// effective date range) plus a `priority` for ordering. There is no
// separate operator schedule policy, no date-override policy, and no
// per-machine assignment table any more — "who can operate at 07:00 on
// Tuesday" has exactly one answer, and it is the same question the
// staff-management tabs already answer for every other role.
//
// Consequences, all intentional:
//   - The number of operator-assisted machine bookings a slot can carry
//     equals the number of operators available for that slot. An
//     operator is an exclusive resource: one booking each.
//   - An operator with NO availability configured is NOT available. An
//     operator becomes eligible for auto-assignment only once an admin
//     has entered at least one weekly window that covers the slot. This
//     is the same rule coaches and sidearm specialists already follow
//     (`slotMatchesMembershipAvailability` returns false on an empty
//     schedule); ground staff are the deliberate exception, because they
//     are the center's floor contact rather than an assignable resource.
//     Consequence to be aware of when rolling this out: a center whose
//     operators have no schedule yet has zero operator capacity, so
//     LEATHER machines are unbookable and TENNIS machines self-operate
//     until the admin fills the schedule in.
//   - Ordering is the membership `priority` (1 = first pick), managed
//     with the same up/down arrows as the Ground Staff tab.

/** One operator on a center's roster, with their weekly schedule. */
export interface OperatorRosterEntry {
  userId: string;
  /** Membership priority — lower is picked first. */
  priority: number;
  /** Weekly windows. Empty = no schedule configured = never available. */
  availability: AvailabilityWindow[];
}

/**
 * Every active OPERATOR membership at the center, priority-ordered, with
 * their weekly availability windows resolved.
 *
 * `centerId` null is the cross-center fallback used by tooling only.
 */
export async function loadOperatorRoster(
  centerId: string | null,
  db: Db = defaultPrisma,
): Promise<OperatorRosterEntry[]> {
  const memberships = await db.centerMembership.findMany({
    where: centerId
      ? { centerId, role: 'OPERATOR', isActive: true }
      : { role: 'OPERATOR', isActive: true },
    select: {
      userId: true,
      priority: true,
      availability: {
        where: { isActive: true },
        select: {
          dayOfWeek: true,
          startTime: true,
          endTime: true,
          effectiveFrom: true,
          effectiveTo: true,
        },
      },
    },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
  });
  return memberships.map((m) => ({
    userId: m.userId,
    priority: m.priority,
    availability: m.availability as AvailabilityWindow[],
  }));
}

/**
 * Is this operator on duty for `slot`?
 *
 * No configured schedule ⇒ NOT on duty (see the module note above): an
 * operator has to opt in to a window before the engine will hand them a
 * booking. Otherwise the slot must fall entirely inside one of their
 * weekly windows, honouring that window's effective date range.
 *
 * `slotMatchesMembershipAvailability` already returns false for an empty
 * schedule, so there is no special case here — that is the point.
 */
export function operatorIsAvailableForSlot(
  entry: Pick<OperatorRosterEntry, 'availability'>,
  slot: BookableSlotWindow,
): boolean {
  return slotMatchesMembershipAvailability(slot, entry.availability);
}

/** The subset of `roster` on duty for `slot`, still priority-ordered. */
export function operatorsAvailableForSlot<T extends Pick<OperatorRosterEntry, 'availability'>>(
  roster: T[],
  slot: BookableSlotWindow,
): T[] {
  return roster.filter((entry) => operatorIsAvailableForSlot(entry, slot));
}

/**
 * Operator ids already committed to a booking that overlaps `slot`.
 *
 * Overlap, not exact-equality: a 07:00–09:00 session keeps its operator
 * busy at 07:30 and 08:00 too.
 */
export async function getBusyOperatorIds(
  centerId: string | null,
  slot: BookableSlotWindow,
  db: Db = defaultPrisma,
): Promise<Set<string>> {
  const rows = await db.booking.findMany({
    where: {
      date: slot.date,
      startTime: { lt: slot.endTime },
      endTime: { gt: slot.startTime },
      status: 'BOOKED',
      operatorId: { not: null },
      ...(centerId ? { centerId } : {}),
    },
    select: { operatorId: true },
  });
  const busy = new Set<string>();
  for (const r of rows) if (r.operatorId) busy.add(r.operatorId);
  return busy;
}

/** How many operator-assisted bookings this slot can still take. */
export interface OperatorSlotCapacity {
  /** Operators whose availability covers the slot. */
  onDuty: number;
  /** Of those, how many already carry an overlapping booking. */
  busy: number;
  /** Remaining capacity — `onDuty - busy`. */
  free: number;
  /** The free operators' user ids, best pick first. */
  freeOperatorIds: string[];
}

/**
 * Resolve operator capacity for a slot from availability alone.
 *
 * `onDuty === 0` means nobody is scheduled: leather machines can't be
 * booked, tennis machines self-operate. `free === 0` with `onDuty > 0`
 * means every scheduled operator is already on another booking — the
 * slot is at capacity.
 */
export async function getOperatorSlotCapacity({
  centerId,
  slot,
  tx,
  roster,
}: {
  centerId: string | null;
  slot: BookableSlotWindow;
  tx?: PrismaTransaction;
  /** Pre-loaded roster (avoids a query when the caller already has it). */
  roster?: OperatorRosterEntry[];
}): Promise<OperatorSlotCapacity> {
  const db = tx || defaultPrisma;
  const full = roster ?? (await loadOperatorRoster(centerId, db));
  const onDuty = operatorsAvailableForSlot(full, slot);
  if (onDuty.length === 0) {
    return { onDuty: 0, busy: 0, free: 0, freeOperatorIds: [] };
  }
  const busy = await getBusyOperatorIds(centerId, slot, db);
  const freeOperatorIds = onDuty.filter((o) => !busy.has(o.userId)).map((o) => o.userId);
  return {
    onDuty: onDuty.length,
    busy: onDuty.length - freeOperatorIds.length,
    free: freeOperatorIds.length,
    freeOperatorIds,
  };
}

/**
 * How many operators are on duty for `slot` — the staffing level, before
 * any booking is taken into account. Zero is the "nobody is working this
 * window" signal the booking engine treats specially.
 */
export async function getAvailableOperatorCount(
  centerId: string | null,
  slot: BookableSlotWindow,
  db: Db = defaultPrisma,
): Promise<number> {
  const roster = await loadOperatorRoster(centerId, db);
  return operatorsAvailableForSlot(roster, slot).length;
}

// ─── Operator Auto-Assignment ─────────────────────────

export interface AutoAssignOperatorArgs {
  date: Date;
  startTime: Date;
  endTime: Date;
  /** Transaction client — pass it so the read joins the tx's read set. */
  tx?: PrismaTransaction;
  centerId?: string | null;
}

/**
 * Auto-assign an operator to a booking.
 *
 * Picks the highest-priority operator who is (a) available for the slot
 * per their weekly schedule and (b) not already assigned to an
 * overlapping booking. Returns null when nobody qualifies — which now
 * genuinely means "this slot is at operator capacity", because every
 * operator-assisted booking consumes one operator.
 */
export async function autoAssignOperator({
  date,
  startTime,
  endTime,
  tx,
  centerId = null,
}: AutoAssignOperatorArgs): Promise<string | null> {
  const capacity = await getOperatorSlotCapacity({
    centerId,
    slot: { date, startTime, endTime },
    tx,
  });
  return capacity.freeOperatorIds[0] ?? null;
}
