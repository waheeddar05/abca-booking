/**
 * Backfill operators onto existing MACHINE bookings that were created
 * with `operatorId = null`.
 *
 * This repairs rows created before the operator-assignment fix, where a
 * slot's on-duty operator count was treated as a per-slot capacity: the
 * first booking of an hour got an operator and every other net booked at
 * the same time silently came out unassigned.
 *
 * Center-aware: each booking is matched against operators who hold an
 * active OPERATOR CenterMembership at THAT booking's center — the same
 * population the admin dropdown and the live auto-assigner use, so the
 * assignments this writes are all renderable and editable in the admin
 * UI. Picks the least-loaded operator for the slot, tie-broken by
 * priority, mirroring `autoAssignOperator`.
 *
 * Usage:
 *   DATABASE_URL="..." npx tsx scripts/fix-unassigned-bookings.ts [--dry-run] [--center=<centerId>]
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const centerArg = args.find((a) => a.startsWith('--center='))?.split('=')[1] || null;

type Candidate = { id: string; name: string | null; priority: number };

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
      select: { user: { select: { id: true, name: true, operatorPriority: true } } },
    });
    const roster: Candidate[] = memberships
      .map((m) => ({
        id: m.user.id,
        name: m.user.name,
        // 0 means "unset" in the app's priority convention — push last.
        priority: m.user.operatorPriority === 0 ? Number.MAX_SAFE_INTEGER : m.user.operatorPriority,
      }))
      .sort((a, b) => a.priority - b.priority);
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

    // Existing load for this slot — overlap, not exact start-time match,
    // so a 07:00-09:00 session counts against 07:30 too.
    const overlapping = await prisma.booking.findMany({
      where: {
        centerId: booking.centerId,
        date: booking.date,
        startTime: { lt: booking.endTime },
        endTime: { gt: booking.startTime },
        status: 'BOOKED',
        operatorId: { in: roster.map((o) => o.id) },
      },
      select: { operatorId: true },
    });
    const load = new Map<string, number>();
    for (const b of overlapping) {
      if (!b.operatorId) continue;
      load.set(b.operatorId, (load.get(b.operatorId) ?? 0) + 1);
    }

    // Least-loaded wins; roster is already priority-sorted so a stable
    // scan keeps priority as the tie-breaker.
    let best = roster[0];
    let bestLoad = load.get(best.id) ?? 0;
    for (const op of roster) {
      const opLoad = load.get(op.id) ?? 0;
      if (opLoad < bestLoad) {
        best = op;
        bestLoad = opLoad;
      }
      if (bestLoad === 0) break;
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
      (skipped > 0 ? ` Skipped ${skipped} (no operators at that center).` : ''),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
