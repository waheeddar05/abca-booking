/**
 * Assign ALL operators to ALL machines.
 * Run with: npx tsx scripts/assign-all-operators.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const ALL_MACHINES = ['GRAVITY', 'YANTRA', 'LEVERAGE_INDOOR', 'LEVERAGE_OUTDOOR'] as const;

async function main() {
  const operators = await prisma.user.findMany({
    where: { role: 'OPERATOR' },
    select: { id: true, name: true, email: true },
  });

  if (operators.length === 0) {
    console.log('No operators found.');
    return;
  }

  console.log(`Found ${operators.length} operators:`);
  operators.forEach(op => console.log(`  - ${op.name || op.email} (${op.id})`));
  console.log(`\nAssigning to ${ALL_MACHINES.length} machines: ${ALL_MACHINES.join(', ')}\n`);

  let created = 0;
  let skipped = 0;

  for (const op of operators) {
    for (const machineId of ALL_MACHINES) {
      try {
        await prisma.operatorAssignment.create({
          data: { userId: op.id, machineId },
        });
        console.log(`  ✓ ${op.name || op.email} → ${machineId}`);
        created++;
      } catch (err: any) {
        if (err?.code === 'P2002') {
          console.log(`  · ${op.name || op.email} → ${machineId} (already assigned)`);
          skipped++;
        } else {
          throw err;
        }
      }
    }
  }

  console.log(`\nDone: ${created} created, ${skipped} already existed.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
