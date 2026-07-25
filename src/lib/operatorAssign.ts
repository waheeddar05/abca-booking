import { PrismaClient, MachineId } from '@prisma/client';
import { prisma as defaultPrisma } from './prisma';
import { getPolicyValue } from './policy';
import type { TimeSlabConfig } from './pricing';
import { getTimeSlab, timeToMinutes } from './pricing';

type PrismaTransaction = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

// ─── Operator Schedule Config ───────────────────────────

export interface OperatorScheduleEntry {
  days: number[];          // 0=Sun..6=Sat
  slab: 'morning' | 'evening';
  count: number;
}

export interface OperatorScheduleConfig {
  default: number;
  schedule: OperatorScheduleEntry[];
}

/** Get day-of-week in IST (0=Sun..6=Sat), locale-independent. */
function getDayOfWeekIST(date: Date): number {
  const istMs = date.getTime() + (5 * 60 + 30) * 60 * 1000;
  return new Date(istMs).getUTCDay();
}

/** Get date string in YYYY-MM-DD format in IST. */
function getDateStringIST(date: Date): string {
  const istMs = date.getTime() + (5 * 60 + 30) * 60 * 1000;
  const istDate = new Date(istMs);
  return `${istDate.getUTCFullYear()}-${String(istDate.getUTCMonth() + 1).padStart(2, '0')}-${String(istDate.getUTCDate()).padStart(2, '0')}`;
}

// ─── Operator Date Override Config ────────────────────────
// New range format: [{ from: "2026-04-10", to: "2026-04-15", morning: 0, evening: 2 }, ...]
//
// A range is either:
//   - slab-based  → morning/evening operator counts (legacy behaviour), or
//   - time-window → startTime/endTime ("HH:MM", IST) + a single `count`
//     applied only to slots whose start falls within [startTime, endTime).
// Time-window ranges take precedence over slab ranges for matching slots.
export interface OperatorDateOverrideRange {
  from: string;
  to: string;
  morning?: number;
  evening?: number;
  recurringDays?: number[]; // 0=Sun..6=Sat; empty/undefined = every day in range
  startTime?: string;       // "HH:MM" IST — time-window override start (inclusive)
  endTime?: string;         // "HH:MM" IST — time-window override end (exclusive)
  count?: number;           // operator count for the time window
}

// Legacy format (individual dates): { "2026-04-10": { morning: 0, evening: 2 } }
type LegacyOverrides = Record<string, { morning: number; evening: number }>;

/** Day-of-week (0=Sun..6=Sat) for a YYYY-MM-DD date string */
function dayOfWeekFromDateKey(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1)).getUTCDay();
}

/** Minutes-since-midnight (IST) for a slot's start time. */
function getMinutesIST(date: Date): number {
  const istStr = date.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false, hour: '2-digit', minute: '2-digit' });
  return timeToMinutes(istStr);
}

/** True when a range carries a usable time-window definition. */
function isTimeWindow(range: OperatorDateOverrideRange): range is OperatorDateOverrideRange & { startTime: string; endTime: string; count: number } {
  return !!range.startTime && !!range.endTime && typeof range.count === 'number';
}

/**
 * Resolve the operator count for a date + slab + slot start time from the
 * override config. Time-window overrides win over slab overrides; within each
 * pass the first matching range wins. Returns undefined when nothing matches.
 */
function findOverrideCount(
  overrides: OperatorDateOverrideRange[] | LegacyOverrides,
  dateKey: string,
  slab: 'morning' | 'evening',
  slotMinutes: number,
): number | undefined {
  // Support new range format (array)
  if (Array.isArray(overrides)) {
    const dow = dayOfWeekFromDateKey(dateKey);
    const inRange = (range: OperatorDateOverrideRange) =>
      dateKey >= range.from && dateKey <= range.to &&
      !(range.recurringDays && range.recurringDays.length > 0 && !range.recurringDays.includes(dow));

    // Pass 1: time-window overrides take precedence
    for (const range of overrides) {
      if (!isTimeWindow(range) || !inRange(range)) continue;
      const start = timeToMinutes(range.startTime);
      const end = timeToMinutes(range.endTime);
      if (slotMinutes >= start && slotMinutes < end) return Math.max(0, range.count);
    }

    // Pass 2: slab-based overrides
    for (const range of overrides) {
      if (isTimeWindow(range) || !inRange(range)) continue;
      const count = slab === 'morning' ? range.morning : range.evening;
      if (typeof count === 'number') return Math.max(0, count);
    }
    return undefined;
  }
  // Legacy format (object with date keys)
  const match = overrides[dateKey];
  if (match) return Math.max(0, slab === 'morning' ? match.morning : match.evening);
  return undefined;
}

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
  db: PrismaTransaction | typeof defaultPrisma = defaultPrisma,
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

// ─── Rostered-operator count ──────────────────────────────
// Used as the "how many operators are on duty" default when a center has
// no explicit schedule. Cached briefly because the availability grid
// asks once per slot in the day. Zero is deliberately NOT cached: a
// brand-new center that gets its first operator must not stay stuck at
// "no operators" for the TTL (module scope is per-serverless-instance,
// so an explicit invalidation can't reach the other warm instances).
const rosterCache = new Map<string, { count: number; expiresAt: number }>();
const ROSTER_TTL_MS = 30_000;

function rosterKey(centerId: string | null): string {
  return centerId ?? '__legacy_global__';
}

/**
 * How many operators are on this center's roster — the exact same pool
 * `loadCenterOperators` picks from, so the on-duty default and the
 * picker can never disagree.
 */
export async function getRosteredOperatorCount(
  centerId: string | null,
  db: PrismaTransaction | typeof defaultPrisma = defaultPrisma,
): Promise<number> {
  const key = rosterKey(centerId);
  const now = Date.now();
  const hit = rosterCache.get(key);
  if (hit && hit.expiresAt > now) return hit.count;

  const count = centerId
    ? await db.centerMembership.count({ where: { centerId, role: 'OPERATOR', isActive: true } })
    : await db.centerMembership.count({ where: { role: 'OPERATOR', isActive: true } });

  // Never cache "no operators" — see the note above.
  if (count > 0) rosterCache.set(key, { count, expiresAt: now + ROSTER_TTL_MS });
  else rosterCache.delete(key);
  return count;
}

/** Drop the cached roster size — call after adding/removing operators. */
export function invalidateOperatorRoster(centerId?: string | null): void {
  if (centerId === undefined) {
    rosterCache.clear();
    return;
  }
  rosterCache.delete(rosterKey(centerId));
}

/**
 * Get the number of operators **on duty** for a given date + time slot.
 * Priority: 1. Date-specific overrides, 2. Day-of-week schedule,
 * 3. Legacy NUMBER_OF_OPERATORS, 4. The center's operator roster size.
 *
 * IMPORTANT — this is a staffing level, NOT a per-slot booking capacity.
 * It answers "is anyone on duty, and how many", and the only value the
 * booking engine treats specially is 0 ("nobody on duty" → self-operate
 * for tennis, refuse for leather). It must never be used to stop
 * assigning an operator to the Nth booking of a slot: one operator
 * walks between nets and covers several bookings in the same hour,
 * which is exactly what admins do by hand today.
 *
 * `centerId` is optional. When supplied, every policy lookup cascades
 * CenterPolicy → Policy → fallback so each center can override scheduling
 * independently. Passing `null` preserves the pre-multi-center behaviour
 * of reading only the global `Policy` table.
 */
export async function getOperatorCount(
  date: Date,
  startTime: Date,
  timeSlabs: TimeSlabConfig,
  centerId: string | null = null,
  db: PrismaTransaction | typeof defaultPrisma = defaultPrisma,
): Promise<number> {
  const slab = getTimeSlab(startTime, timeSlabs);
  const slotMinutes = getMinutesIST(startTime);

  // 1. Check date-specific overrides first (highest priority)
  try {
    const overridesStr = await getPolicyValue('OPERATOR_DATE_OVERRIDES', centerId);
    if (overridesStr) {
      const overrides = JSON.parse(overridesStr);
      const dateKey = getDateStringIST(date);
      const count = findOverrideCount(overrides, dateKey, slab, slotMinutes);
      if (count !== undefined) return count;
    }
  } catch (e) {
    console.warn('[OperatorAssign] Error parsing OPERATOR_DATE_OVERRIDES:', e);
  }

  // 2. Check day-of-week schedule config. A config that carries neither
  //    a matching day+slab entry nor a numeric `default` is treated as
  //    "unset" and falls through to the roster size below — an empty
  //    `{ schedule: [] }` must not silently cap the center at one
  //    operator per slot.
  try {
    const configStr = await getPolicyValue('OPERATOR_SCHEDULE_CONFIG', centerId);
    if (configStr) {
      const config: OperatorScheduleConfig = JSON.parse(configStr);
      const day = getDayOfWeekIST(date);
      const match = config.schedule?.find(e => e.days.includes(day) && e.slab === slab);
      if (typeof match?.count === 'number') return Math.max(0, match.count);
      if (typeof config.default === 'number') return Math.max(0, config.default);
    }
  } catch (e) {
    console.warn('[OperatorAssign] Error parsing OPERATOR_SCHEDULE_CONFIG:', e);
  }

  // 3. Legacy fallback
  try {
    const val = await getPolicyValue('NUMBER_OF_OPERATORS', centerId);
    if (val) {
      const parsed = parseInt(val, 10);
      if (Number.isFinite(parsed)) return Math.max(1, parsed);
    }
  } catch { /* ignore */ }

  // 4. Nothing configured → everyone on the roster counts as on duty.
  try {
    return await getRosteredOperatorCount(centerId, db);
  } catch (e) {
    console.warn('[OperatorAssign] Error counting rostered operators:', e);
    return 1;
  }
}

// ─── Operator Auto-Assignment ─────────────────────────

type DayPriorities = Record<string, { morning: number; evening: number }>;
type OperatorInfo = { id: string; operatorPriority: number; operatorMorningPriority: number; operatorEveningPriority: number; operatorDayPriorities?: DayPriorities | null };
const OPERATOR_SELECT = { id: true, operatorPriority: true, operatorMorningPriority: true, operatorEveningPriority: true, operatorDayPriorities: true } as const;

/**
 * Sort operators by priority for a given slab and day of week.
 * Priority resolution order:
 * 1. Day-specific slab priority (operatorDayPriorities[dayOfWeek][slab]) — most specific
 * 2. General slab priority (operatorMorningPriority / operatorEveningPriority)
 * 3. Overall priority (operatorPriority) — tiebreaker
 * Lower number = higher priority. 0 means unset, pushed to end.
 */
function sortByPriority(operators: OperatorInfo[], slab: 'morning' | 'evening', dayOfWeek?: number): OperatorInfo[] {
  return [...operators].sort((a, b) => {
    const getEffective = (op: OperatorInfo): number => {
      // Check day-specific priority first
      if (dayOfWeek !== undefined && op.operatorDayPriorities) {
        const dayPri = (op.operatorDayPriorities as DayPriorities)?.[String(dayOfWeek)];
        if (dayPri) {
          const val = slab === 'morning' ? dayPri.morning : dayPri.evening;
          if (val && val > 0) return val;
        }
      }
      // Fall back to general slab priority
      const slabPri = slab === 'morning' ? op.operatorMorningPriority : op.operatorEveningPriority;
      return slabPri === 0 ? Infinity : slabPri;
    };

    const aEff = getEffective(a);
    const bEff = getEffective(b);
    if (aEff !== bEff) return aEff - bEff;
    const aOverall = a.operatorPriority === 0 ? Infinity : a.operatorPriority;
    const bOverall = b.operatorPriority === 0 ? Infinity : b.operatorPriority;
    return aOverall - bOverall;
  });
}

/**
 * Resolve the candidate operator pool for a center.
 *
 * - `centerId` null  → legacy ABCA path: `role: 'OPERATOR'` on User.
 * - `centerId` set   → users with a CenterMembership(centerId, role: OPERATOR).
 *
 * The new path matches how RESOURCE_BASED centers are administered (Toplay's
 * operators live as memberships, not as User.role).
 */
async function loadCenterOperators(
  db: PrismaTransaction | typeof defaultPrisma,
  centerId: string | null,
): Promise<OperatorInfo[]> {
  const memberships = await db.centerMembership.findMany({
    where: centerId
      ? { centerId, role: 'OPERATOR', isActive: true }
      : { role: 'OPERATOR', isActive: true },
    include: { user: { select: OPERATOR_SELECT } },
  });
  return memberships.map(m => ({
    id: m.user.id,
    operatorPriority: m.user.operatorPriority,
    operatorMorningPriority: m.user.operatorMorningPriority,
    operatorEveningPriority: m.user.operatorEveningPriority,
    operatorDayPriorities: m.user.operatorDayPriorities as DayPriorities | null,
  }));
}

/**
 * Load the operators an admin explicitly assigned to a machine, honouring
 * the per-assignment weekday filter (`days`; empty = every day).
 *
 * Two machine axes exist:
 *   - `machineId`    — the legacy `MachineId` enum (MACHINE_PITCH centers).
 *   - `machineRowId` — a `Machine` row id (RESOURCE_BASED centers).
 * Callers pass whichever one their booking model uses; passing neither
 * returns an empty pool so the caller falls back to the full roster.
 */
async function loadAssignedOperators(
  db: PrismaTransaction | typeof defaultPrisma,
  centerId: string | null,
  dayOfWeek: number,
  machineId?: MachineId | null,
  machineRowId?: string | null,
): Promise<OperatorInfo[]> {
  if (!machineId && !machineRowId) return [];

  const machineWhere = machineRowId ? { machineRowId } : { machineId: machineId! };
  const assignments = await db.operatorAssignment.findMany({
    where: centerId ? { ...machineWhere, centerId } : machineWhere,
    include: {
      user: {
        select: {
          ...OPERATOR_SELECT,
          role: true,
          // Source of truth for "is this user an OPERATOR at this
          // center" is CenterMembership, not User.role — same
          // reasoning as `/api/admin/operators`. Pull the per-center
          // membership rows so we can filter on them instead.
          centerMemberships: centerId
            ? { where: { centerId, role: 'OPERATOR' as const, isActive: true }, select: { id: true } }
            : { where: { role: 'OPERATOR' as const, isActive: true }, select: { id: true } },
        },
      },
    },
  });

  return assignments
    .filter(a => {
      // Check if days is empty (all days) or includes current day
      const daysFilter = a.days;
      return daysFilter.length === 0 || daysFilter.includes(dayOfWeek);
    })
    .filter(a =>
      // Active OPERATOR membership at this center — the one definition
      // (see the header note). This used to also admit a bare
      // `User.role === 'OPERATOR'`, which let the auto-assigner pick
      // someone the membership-scoped admin dropdown cannot render, so
      // the booking displayed as "Unassigned" despite having an
      // operator. A stale machine assignment must not outrank the
      // roster.
      (a.user.centerMemberships?.length ?? 0) > 0,
    )
    .map(a => ({ id: a.user.id, operatorPriority: a.user.operatorPriority, operatorMorningPriority: a.user.operatorMorningPriority, operatorEveningPriority: a.user.operatorEveningPriority, operatorDayPriorities: a.user.operatorDayPriorities as DayPriorities | null }));
}

/**
 * Auto-assign an operator to a booking.
 *
 * Returns null ONLY when the center has no operators at all. As long as
 * somebody is on the roster this always names one — a slot with more
 * bookings than operators gives the busiest-but-highest-priority person
 * a second booking rather than leaving the row unassigned. That matches
 * how the centers actually run (one operator walks between nets) and is
 * exactly the manual assignment admins were doing to paper over the old
 * behaviour.
 *
 * Candidate resolution:
 *   1. Operators explicitly assigned to this machine (either machine
 *      axis) and rostered for this weekday — preferred.
 *   2. Any other operator at the center.
 * Within that order, the operator carrying the fewest bookings in this
 * slot wins, ties broken by priority (day+slab, then overall).
 *
 * `centerId` scopes the candidate pool to a center's memberships. Pass
 * null only for cross-center tooling.
 */
export interface AutoAssignOperatorArgs {
  date: Date;
  startTime: Date;
  /** Slot end. Used for overlap-aware load counting; defaults to a zero-length window. */
  endTime?: Date | null;
  /** Transaction client — pass it so the read joins the tx's read set. */
  tx?: PrismaTransaction;
  /** Legacy `MachineId` enum (MACHINE_PITCH centers). */
  machineId?: MachineId | null;
  /** `Machine` row id (RESOURCE_BASED centers). */
  machineRowId?: string | null;
  timeSlab?: 'morning' | 'evening';
  centerId?: string | null;
}

export async function autoAssignOperator({
  date,
  startTime,
  endTime = null,
  tx,
  machineId = null,
  machineRowId = null,
  timeSlab,
  centerId = null,
}: AutoAssignOperatorArgs): Promise<string | null> {
  const db = tx || defaultPrisma;
  const slab = timeSlab || 'morning';
  const dayOfWeek = getDayOfWeekIST(date);

  // Machine-specific pool first, then everyone else at the center.
  const assigned = await loadAssignedOperators(db, centerId, dayOfWeek, machineId, machineRowId);
  const roster = await loadCenterOperators(db, centerId);

  const assignedIds = new Set(assigned.map(o => o.id));
  // Preference order: machine-assigned operators, then the rest of the
  // roster. Each group is priority-sorted independently so an explicit
  // machine assignment always outranks a generic one.
  const preferred = sortByPriority(assigned, slab, dayOfWeek);
  const others = sortByPriority(roster.filter(o => !assignedIds.has(o.id)), slab, dayOfWeek);
  const sorted = [...preferred, ...others];

  if (sorted.length === 0) return null;

  // How many bookings each candidate already carries in this slot
  // (scoped to center when supplied so cross-center bookings don't mask
  // availability). Overlap, not exact-equality: a 07:00–09:00 session
  // keeps its operator busy at 07:30 and 08:00 too, which exact
  // startTime matching missed.
  const busyBookings = await db.booking.findMany({
    where: {
      date,
      ...(endTime
        ? { startTime: { lt: endTime }, endTime: { gt: startTime } }
        : { startTime }),
      status: 'BOOKED',
      operatorId: { in: sorted.map(o => o.id) },
      ...(centerId ? { centerId } : {}),
    },
    select: { operatorId: true },
  });
  const load = new Map<string, number>();
  for (const b of busyBookings) {
    if (!b.operatorId) continue;
    load.set(b.operatorId, (load.get(b.operatorId) ?? 0) + 1);
  }

  // `sorted` is already in preference order, so a stable min-by-load
  // scan keeps machine-assignment and priority as the tie-breakers.
  let best = sorted[0];
  let bestLoad = load.get(best.id) ?? 0;
  for (const op of sorted) {
    const opLoad = load.get(op.id) ?? 0;
    if (opLoad < bestLoad) {
      best = op;
      bestLoad = opLoad;
    }
    if (bestLoad === 0) break;
  }
  return best.id;
}
