/**
 * Backfill operators onto existing MACHINE bookings that were created
 * with `operatorId = null`.
 *
 * Center-aware: each booking is matched against operators who hold an
 * active OPERATOR CenterMembership at THAT booking's center — the same
 * population the admin dropdown and the live auto-assigner use, so the
 * assignments this writes are all renderable and editable in the admin
 * UI.
 *
 * Selection mirrors `autoAssignOperator`: the highest-priority operator
 * whose weekly availability covers the slot and who isn't already on an
 * overlapping booking. An operator serves one booking at a time, so a
 * booking whose slot has no free operator is left unassigned and
 * reported.
 *
 * Usage:
 *   DATABASE_URL="..." npx tsx scripts/fix-unassigned-bookings.ts [--dry-run] [--center=<centerId>]
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const centerArg = args.find((a) => a.startsWith('--center='))?.split('=')[1] || null;

type Window = {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
};
type Candidate = { id: string; name: string | null; availability: Window[] };

/** IST day-of-week (0=Sun..6=Sat). */
function istDayOfWeek(d: Date): number {
  return new Date(d.getTime() + (5 * 60 + 30) * 60 * 1000).getUTCDay();
}

/** IST wall-clock "HH:MM". */
function istHHMM(d: Date): string {
  const ist = new Date(d.getTime() + (5 * 60 + 30) * 60 * 1000);
  return `${String(ist.getUTCHours()).padStart(2, '0')}:${String(ist.getUTCMinutes()).padStart(2, '0')}`;
}

/**
 * Same rule as `operatorIsAvailableForSlot`: no configured schedule means
 * NOT available (an operator has to have a window before the engine will
 * hand them a booking); otherwise the slot must fit entirely inside one
 * weekly window whose effective date range covers the booking's date.
 */
function isAvailable(op: Candidate, booking: { date: Date; startTime: Date; endTime: Date }): boolean {
  if (op.availability.length === 0) return false;
  const dow = istDayOfWeek(booking.startTime);
  const dateMs = booking.date.getTime();
  const start = istHHMM(booking.startTime);
  const end = istHHMM(booking.endTime);
  return op.availability.some((w) => {
    if (w.dayOfWeek !== dow) return false;
    if (w.effectiveFrom && dateMs < w.effectiveFrom.getTime()) return false;
    if (w.effectiveTo && dateMs > w.effectiveTo.getTime()) return false;
    return start >= w.startTime && end <= w.endTime;
  });
}

async function main() {
  const unassigned = await prisma.booking.findMany({
    where: {
      operatorId: null,
      status: 'BOOKED',
      category: 'MACHINE',
      operationMode: 'WITH_OPERATOR',
      ...(centerArg ? { centerId: centerArg } : {}),
    },
    select: {
      id: true,
      centerId: true,
      date: true,
      startTime: true,
      endTime: true,
      playerName: true,
    },
    orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
  });

  console.log(
    `Found ${unassigned.length} unassigned MACHINE booking(s)` +
      (centerArg ? ` at center ${centerArg}` : '') +
      (dryRun ? ' — DRY RUN, nothing will be written' : ''),
  );
  if (unassigned.length === 0) return;

  // Operator roster per center, cached across the loop.
  const rosterByCenter = new Map<string, Candidate[]>();
  async function rosterFor(centerId: string): Promise<Candidate[]> {
    const cached = rosterByCenter.get(centerId);
    if (cached) return cached;
    const memberships = await prisma.centerMembership.findMany({
      where: { centerId, role: 'OPERATOR', isActive: true },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      select: {
        user: { select: { id: true, name: true } },
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
    });
    const roster: Candidate[] = memberships.map((m) => ({
      id: m.user.id,
      name: m.user.name,
      availability: m.availability,
    }));
    rosterByCenter.set(centerId, roster);
    return roster;
  }

  let assigned = 0;
  let skipped = 0;

  for (const booking of unassigned) {
    const roster = await rosterFor(booking.centerId);
    if (roster.length === 0) {
      console.log(`  – ${booking.playerName}: no operators at center ${booking.centerId}, skipping`);
      skipped++;
      continue;
    }

    const onDuty = roster.filter((op) => isAvailable(op, booking));
    if (onDuty.length === 0) {
      console.log(`  – ${booking.playerName}: no operator available for that slot, skipping`);
      skipped++;
      continue;
    }

    // Operators already committed to an overlapping booking — a
    // 07:00-09:00 session counts against 07:30 too.
    const overlapping = await prisma.booking.findMany({
      where: {
        centerId: booking.centerId,
        date: booking.date,
        startTime: { lt: booking.endTime },
        endTime: { gt: booking.startTime },
        status: 'BOOKED',
        operatorId: { in: onDuty.map((o) => o.id) },
      },
      select: { operatorId: true },
    });
    const busy = new Set(overlapping.map((b) => b.operatorId).filter((id): id is string => !!id));

    // Roster is priority-ordered, so the first free operator is the pick.
    const best = onDuty.find((op) => !busy.has(op.id));
    if (!best) {
      console.log(`  – ${booking.playerName}: all operators busy in that slot, skipping`);
      skipped++;
      continue;
    }

    if (!dryRun) {
      await prisma.booking.update({
        where: { id: booking.id },
        data: { operatorId: best.id },
      });
    }
    console.log(`  ✓ ${booking.playerName} → ${best.name || best.id}`);
    assigned++;
  }

  console.log(
    `\n${dryRun ? 'Would assign' : 'Assigned'} operators to ${assigned} booking(s).` +
      (skipped > 0 ? ` Skipped ${skipped} (no free operator).` : ''),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
