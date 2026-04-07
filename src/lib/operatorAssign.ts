import { PrismaClient, MachineId } from '@prisma/client';
import { prisma as defaultPrisma } from './prisma';
import { getCachedPolicy } from './policy-cache';
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

/**
 * Get the number of operators needed for a given date + time slot.
 * Reads OPERATOR_SCHEDULE_CONFIG from policy, falls back to NUMBER_OF_OPERATORS, then 1.
 */
export async function getOperatorCount(
  date: Date,
  startTime: Date,
  timeSlabs: TimeSlabConfig
): Promise<number> {
  try {
    const configStr = await getCachedPolicy('OPERATOR_SCHEDULE_CONFIG');
    if (configStr) {
      const config: OperatorScheduleConfig = JSON.parse(configStr);
      const day = getDayOfWeekIST(date);
      const slab = getTimeSlab(startTime, timeSlabs);
      const match = config.schedule.find(e => e.days.includes(day) && e.slab === slab);
      return Math.max(1, match?.count ?? config.default ?? 1);
    }
  } catch (e) {
    console.warn('[OperatorAssign] Error parsing OPERATOR_SCHEDULE_CONFIG:', e);
  }

  try {
    const val = await getCachedPolicy('NUMBER_OF_OPERATORS');
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
 * Auto-assign an operator to a booking based on priority and availability.
 * Picks the highest-priority operator not already booked at the same time.
 * Falls back to highest-priority operator if all are busy.
 * Respects weekday preferences from OperatorAssignment.days.
 */
export async function autoAssignOperator(
  date: Date,
  startTime: Date,
  tx?: PrismaTransaction,
  machineId?: MachineId | null,
  timeSlab?: 'morning' | 'evening'
): Promise<string | null> {
  const db = tx || defaultPrisma;
  const slab = timeSlab || 'morning';
  const dayOfWeek = getDayOfWeekIST(date);

  // Get candidate operators — machine-specific first, fallback to all
  let operators: OperatorInfo[] = [];
  if (machineId) {
    const assignments = await db.operatorAssignment.findMany({
      where: { machineId },
      include: { user: { select: { ...OPERATOR_SELECT, role: true } } },
    });
    operators = assignments
      .filter(a => {
        // Check if days is empty (all days) or includes current day
        const daysFilter = a.days;
        return daysFilter.length === 0 || daysFilter.includes(dayOfWeek);
      })
      .filter(a => a.user.role === 'OPERATOR')
      .map(a => ({ id: a.user.id, operatorPriority: a.user.operatorPriority, operatorMorningPriority: a.user.operatorMorningPriority, operatorEveningPriority: a.user.operatorEveningPriority, operatorDayPriorities: a.user.operatorDayPriorities as DayPriorities | null }));
  }

  // Fallback: no machine-specific assignments → use all operators
  if (operators.length === 0) {
    const allOps = await db.user.findMany({
      where: { role: 'OPERATOR' },
      select: OPERATOR_SELECT,
    });
    operators = allOps.map(op => ({
      ...op,
      operatorDayPriorities: op.operatorDayPriorities as DayPriorities | null,
    }));
  }

  if (operators.length === 0) return null;
  if (operators.length === 1) return operators[0].id;

  const sorted = sortByPriority(operators, slab, dayOfWeek);

  // Find which operators are already booked at this time
  const busyBookings = await db.booking.findMany({
    where: { date, startTime, status: 'BOOKED', operatorId: { in: sorted.map(o => o.id) } },
    select: { operatorId: true },
  });
  const busyIds = new Set(busyBookings.map(b => b.operatorId));

  // Pick first available, or fallback to highest priority
  return sorted.find(op => !busyIds.has(op.id))?.id ?? sorted[0].id;
}
