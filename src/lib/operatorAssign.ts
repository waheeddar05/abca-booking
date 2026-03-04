import { Prisma, PrismaClient, MachineId } from '@prisma/client';
import { prisma as defaultPrisma } from './prisma';

type PrismaTransaction = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/**
 * Auto-assign an operator to a booking based on priority and machine assignment.
 *
 * Logic (next-available-by-priority):
 * 1. Get all operators assigned to the given machine, ordered by operatorPriority DESC
 * 2. If 0 operators → return null
 * 3. If 1 operator → return their ID
 * 4. If multiple → pick the first (highest priority) operator who doesn't
 *    already have a BOOKED booking at the same date + startTime.
 *    If all are busy, fallback to highest-priority operator.
 */
export async function autoAssignOperator(
  date: Date,
  startTime: Date,
  tx?: PrismaTransaction,
  machineId?: MachineId | null
): Promise<string | null> {
  const db = tx || defaultPrisma;

  // If machineId is provided, only consider operators assigned to that machine
  let operators: Array<{ id: string; operatorPriority: number }>;

  if (machineId) {
    // Get operators who have an assignment for this specific machine
    const assignments = await db.operatorAssignment.findMany({
      where: { machineId },
      select: {
        user: {
          select: { id: true, operatorPriority: true, role: true },
        },
      },
    });

    operators = assignments
      .filter((a) => a.user.role === 'OPERATOR')
      .map((a) => ({ id: a.user.id, operatorPriority: a.user.operatorPriority }))
      .sort((a, b) => b.operatorPriority - a.operatorPriority);
  } else {
    // Fallback: get all operators ordered by priority (highest first)
    operators = await db.user.findMany({
      where: { role: 'OPERATOR' },
      select: { id: true, operatorPriority: true },
      orderBy: { operatorPriority: 'desc' },
    });
  }

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
