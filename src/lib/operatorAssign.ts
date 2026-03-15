import { Prisma, PrismaClient, MachineId } from '@prisma/client';
import { prisma as defaultPrisma } from './prisma';
import { getCachedPolicy } from './policy-cache';
import type { TimeSlabConfig } from './pricing';
import { getTimeSlab } from './pricing';

type PrismaTransaction = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

// ─── Operator Schedule Config (Feature 3) ───────────────────────────

export interface OperatorScheduleEntry {
  days: number[];          // 0=Sun..6=Sat
  slab: 'morning' | 'evening';
  count: number;
}

export interface OperatorScheduleConfig {
  default: number;
  schedule: OperatorScheduleEntry[];
}

/**
 * Get the number of operators needed for a given date + time slot.
 * Reads OPERATOR_SCHEDULE_CONFIG from policy cache.
 * Falls back to NUMBER_OF_OPERATORS legacy key, then to 1.
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
      const dayOfWeek = getDayOfWeekIST(date);
      const slab = getTimeSlab(startTime, timeSlabs);

      // Find matching schedule entry
      for (const entry of config.schedule) {
        if (entry.days.includes(dayOfWeek) && entry.slab === slab) {
          return Math.max(1, entry.count);
        }
      }

      return Math.max(1, config.default || 1);
    }
  } catch (e) {
    console.warn('[OperatorAssign] Error parsing OPERATOR_SCHEDULE_CONFIG:', e);
  }

  // Legacy fallback: single NUMBER_OF_OPERATORS policy
  try {
    const legacyVal = await getCachedPolicy('NUMBER_OF_OPERATORS');
    if (legacyVal) {
      return Math.max(1, parseInt(legacyVal, 10));
    }
  } catch { /* ignore */ }

  return 1;
}

/**
 * Get day-of-week from a Date, in IST timezone.
 * Returns 0=Sun, 1=Mon, ..., 6=Sat.
 */
function getDayOfWeekIST(date: Date): number {
  const istStr = date.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short' });
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  // Fallback: use the raw date's getDay() if locale parse fails
  return dayMap[istStr] ?? date.getUTCDay();
}

// ─── Operator Auto-Assignment (Feature 2 — slab-based priority) ─────

/**
 * Auto-assign an operator to a booking based on priority and machine assignment.
 *
 * Logic (next-available-by-priority):
 * 1. Get all operators assigned to the given machine, ordered by slab-specific priority DESC
 * 2. If 0 operators → return null
 * 3. If 1 operator → return their ID
 * 4. If multiple → pick the first (highest priority) operator who doesn't
 *    already have a BOOKED booking at the same date + startTime.
 *    If all are busy, fallback to highest-priority operator.
 *
 * @param timeSlab - 'morning' | 'evening' — used to sort by the correct priority field
 */
export async function autoAssignOperator(
  date: Date,
  startTime: Date,
  tx?: PrismaTransaction,
  machineId?: MachineId | null,
  timeSlab?: 'morning' | 'evening'
): Promise<string | null> {
  const db = tx || defaultPrisma;
  const slab = timeSlab || 'morning'; // default to morning if not specified

  // If machineId is provided, only consider operators assigned to that machine
  let operators: Array<{ id: string; operatorPriority: number; operatorMorningPriority: number; operatorEveningPriority: number }>;

  if (machineId) {
    // Get operators who have an assignment for this specific machine
    const assignments = await db.operatorAssignment.findMany({
      where: { machineId },
      select: {
        user: {
          select: { id: true, operatorPriority: true, operatorMorningPriority: true, operatorEveningPriority: true, role: true },
        },
      },
    });

    operators = assignments
      .filter((a) => a.user.role === 'OPERATOR')
      .map((a) => ({
        id: a.user.id,
        operatorPriority: a.user.operatorPriority,
        operatorMorningPriority: a.user.operatorMorningPriority,
        operatorEveningPriority: a.user.operatorEveningPriority,
      }));

    // Fallback: if no machine-specific assignments, use ALL operators
    if (operators.length === 0) {
      operators = await db.user.findMany({
        where: { role: 'OPERATOR' },
        select: { id: true, operatorPriority: true, operatorMorningPriority: true, operatorEveningPriority: true },
      });
    }
  } else {
    // No machineId: get all operators
    operators = await db.user.findMany({
      where: { role: 'OPERATOR' },
      select: { id: true, operatorPriority: true, operatorMorningPriority: true, operatorEveningPriority: true },
    });
  }

  // Sort by slab-specific priority (DESC), then operatorPriority as tiebreaker
  operators.sort((a, b) => {
    const aPri = slab === 'morning' ? a.operatorMorningPriority : a.operatorEveningPriority;
    const bPri = slab === 'morning' ? b.operatorMorningPriority : b.operatorEveningPriority;
    if (bPri !== aPri) return bPri - aPri;
    return b.operatorPriority - a.operatorPriority; // tiebreaker
  });

  if (operators.length === 0) return null;
  if (operators.length === 1) return operators[0].id;

  // Check which operators are busy at this time slot
  const busyOperators = await db.booking.findMany({
    where: {
      date,
      startTime,
      status: 'BOOKED',
      operatorId: { in: operators.map((o) => o.id) },
    },
    select: { operatorId: true },
  });

  const busyIds = new Set(busyOperators.map((b) => b.operatorId));

  // Pick the first available operator by priority
  for (const op of operators) {
    if (!busyIds.has(op.id)) {
      return op.id;
    }
  }

  // All busy — fallback to highest priority
  return operators[0].id;
}
