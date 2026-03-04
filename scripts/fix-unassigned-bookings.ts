/**
 * Assign operators to existing unassigned BOOKED bookings.
 * Run with: DATABASE_URL="..." npx tsx scripts/fix-unassigned-bookings.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const unassigned = await prisma.booking.findMany({
    where: { operatorId: null, status: 'BOOKED', operationMode: 'WITH_OPERATOR' },
    select: { id: true, date: true, startTime: true, machineId: true, playerName: true },
    orderBy: { date: 'asc' },
  });

  console.log(`Found ${unassigned.length} unassigned bookings`);

  const operators = await prisma.user.findMany({
    where: { role: 'OPERATOR' },
    select: { id: true, name: true, operatorPriority: true },
    orderBy: { operatorPriority: 'desc' },
  });

  if (operators.length === 0) {
    console.log('No operators found');
    return;
  }

  let assigned = 0;
  for (const booking of unassigned) {
    const busy = await prisma.booking.findMany({
      where: {
        date: booking.date,
        startTime: booking.startTime,
        status: 'BOOKED',
        operatorId: { not: null },
      },
      select: { operatorId: true },
    });
    const busyIds = new Set(busy.map(b => b.operatorId));

    const available = operators.find(op => !busyIds.has(op.id)) || operators[0];

    await prisma.booking.update({
      where: { id: booking.id },
      data: { operatorId: available.id },
    });
    console.log(`  ✓ ${booking.playerName} → ${available.name}`);
    assigned++;
  }

  console.log(`\nAssigned operators to ${assigned} bookings.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
