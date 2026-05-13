import { PrismaClient, MachineId } from '@prisma/client';
import { prisma as defaultPrisma } from './prisma';
import { getPolicyValue } from './policy';
import type { TimeSlabConfig } from './pricing';
import { getTimeSlab } from './pricing';

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
export interface OperatorDateOverrideRange {
  from: string;
  to: string;
  morning: number;
  evening: number;
  recurringDays?: number[]; // 0=Sun..6=Sat; empty/undefined = every day in range
}

// Legacy format (individual dates): { "2026-04-10": { morning: 0, evening: 2 } }
type LegacyOverrides = Record<string, { morning: number; evening: number }>;

/** Day-of-week (0=Sun..6=Sat) for a YYYY-MM-DD date string */
function dayOfWeekFromDateKey(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1)).getUTCDay();
}

/** Check if a YYYY-MM-DD date key falls within any override range */
function findOverrideForDate(
  overrides: OperatorDateOverrideRange[] | LegacyOverrides,
  dateKey: string
): { morning: number; evening: number } | undefined {
  // Support new range format (array)
  if (Array.isArray(overrides)) {
    const dow = dayOfWeekFromDateKey(dateKey);
    for (const range of overrides) {
      if (dateKey < range.from || dateKey > range.to) continue;
      if (range.recurringDays && range.recurringDays.length > 0 && !range.recurringDays.includes(dow)) continue;
      return { morning: range.morning, evening: range.evening };
    }
    return undefined;
  }
  // Legacy format (object with date keys)
  return overrides[dateKey];
}

/**
 * Get the number of operators needed for a given date + time slot.
 * Priority: 1. Date-specific overrides, 2. Day-of-week schedule, 3. Legacy NUMBER_OF_OPERATORS, 4. Default 1.
 * Returns 0 when explicitly configured (allows "no operator" mode).
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
): Promise<number> {
  const slab = getTimeSlab(startTime, timeSlabs);

  // 1. Check date-specific overrides first (highest priority)
  try {
    const overridesStr = await getPolicyValue('OPERATOR_DATE_OVERRIDES', centerId);
    if (overridesStr) {
      const overrides = JSON.parse(overridesStr);
      const dateKey = getDateStringIST(date);
      const match = findOverrideForDate(overrides, dateKey);
      if (match !== undefined) {
        const count = match[slab];
        if (count !== undefined) return Math.max(0, count);
      }
    }
  } catch (e) {
    console.warn('[OperatorAssign] Error parsing OPERATOR_DATE_OVERRIDES:', e);
  }

  // 2. Check day-of-week schedule config
  try {
    const configStr = await getPolicyValue('OPERATOR_SCHEDULE_CONFIG', centerId);
    if (configStr) {
      const config: OperatorScheduleConfig = JSON.parse(configStr);
      const day = getDayOfWeekIST(date);
      const match = config.schedule.find(e => e.days.includes(day) && e.slab === slab);
      return Math.max(0, match?.count ?? config.default ?? 1);
    }
  } catch (e) {
    console.warn('[OperatorAssign] Error parsing OPERATOR_SCHEDULE_CONFIG:', e);
  }

  // 3. Legacy fallback
  try {
    const val = await getPolicyValue('NUMBER_OF_OPERATORS', centerId);
    if (val) return Math.max(1, parseInt(val, 10));
  } catch { /* ignore */ }

  return 1;
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
  if (!centerId) {
    const rows = await db.user.findMany({
      where: { role: 'OPERATOR' },
      select: OPERATOR_SELECT,
    });
    return rows.map(op => ({ ...op, operatorDayPriorities: op.operatorDayPriorities as DayPriorities | null }));
  }
  const memberships = await db.centerMembership.findMany({
    where: { centerId, role: 'OPERATOR' },
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
 * Auto-assign an operator to a booking based on priority and availability.
 * Picks the highest-priority operator not already booked at the same time.
 * Falls back to highest-priority operator if all are busy.
 * Respects weekday preferences from OperatorAssignment.days.
 *
 * `centerId` scopes the candidate pool to a center's memberships. ABCA
 * callers can pass `null` to keep the legacy global `role: 'OPERATOR'`
 * lookup; new code should pass the resolved center.
 */
export async function autoAssignOperator(
  date: Date,
  startTime: Date,
  tx?: PrismaTransaction,
  machineId?: MachineId | null,
  timeSlab?: 'morning' | 'evening',
  centerId: string | null = null,
): Promise<string | null> {
  const db = tx || defaultPrisma;
  const slab = timeSlab || 'morning';
  const dayOfWeek = getDayOfWeekIST(date);

  // Get candidate operators — machine-specific first, fallback to all center operators.
  let operators: OperatorInfo[] = [];
  if (machineId) {
    const assignments = await db.operatorAssignment.findMany({
      where: centerId ? { machineId, centerId } : { machineId },
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
    operators = assignments
      .filter(a => {
        // Check if days is empty (all days) or includes current day
        const daysFilter = a.days;
        return daysFilter.length === 0 || daysFilter.includes(dayOfWeek);
      })
      .filter(a =>
        // Either:
        //   - legacy: User.role === 'OPERATOR' (works for ABCA where
        //     the bumping ladder always set User.role correctly), OR
        //   - new: any active OPERATOR CenterMembership at this center
        //     (catches users whose User.role was outranked by an ADMIN
        //     membership elsewhere, or who were added via the Members
        //     tab on a RESOURCE_BASED center).
        a.user.role === 'OPERATOR' || (a.user.centerMemberships?.length ?? 0) > 0,
      )
      .map(a => ({ id: a.user.id, operatorPriority: a.user.operatorPriority, operatorMorningPriority: a.user.operatorMorningPriority, operatorEveningPriority: a.user.operatorEveningPriority, operatorDayPriorities: a.user.operatorDayPriorities as DayPriorities | null }));
  }

  // Fallback: no machine-specific assignments → use all operators at this center.
  if (operators.length === 0) {
    operators = await loadCenterOperators(db, centerId);
  }

  if (operators.length === 0) return null;
  if (operators.length === 1) return operators[0].id;

  const sorted = sortByPriority(operators, slab, dayOfWeek);

  // Find which operators are already booked at this time (scoped to center
  // when supplied so cross-center bookings don't mask availability).
  const busyBookings = await db.booking.findMany({
    where: {
      date,
      startTime,
      status: 'BOOKED',
      operatorId: { in: sorted.map(o => o.id) },
      ...(centerId ? { centerId } : {}),
    },
    select: { operatorId: true },
  });
  const busyIds = new Set(busyBookings.map(b => b.operatorId));

  // Pick first available, or fallback to highest priority
  return sorted.find(op => !busyIds.has(op.id))?.id ?? sorted[0].id;
}
