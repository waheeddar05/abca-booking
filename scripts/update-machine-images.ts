/**
 * One-off maintenance: fix MachineType.imageUrl in the live catalog so the
 * resource-based booking flow (Toplay) and packages pages render the correct
 * machine photos.
 *
 *   LEVERAGE  (a.k.a. "Master 200" / "iWinner" tennis machine) -> /images/master-200.jpeg
 *   YANTRA                                                      -> /images/yantra.jpeg
 *
 * Idempotent — safe to re-run. Prints the DB host plus before/after state.
 *
 *   Run: npx tsx scripts/update-machine-images.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Map each machine-type CODE to the photo of the machine it actually is:
//   LEVERAGE -> "iWinner" / "Leverage Tennis" machine  -> leverage-tennis.jpeg
//   iWinner  -> prod-only catalog row named "Master200" -> master-200.jpeg
//   YANTRA   -> Yantra                                  -> yantra.jpeg
// updateMany is keyed by code, so rows absent in a given env simply match 0.
const UPDATES: Array<{ code: string; imageUrl: string }> = [
  { code: 'LEVERAGE', imageUrl: '/images/leverage-tennis.jpeg' },
  { code: 'iWinner', imageUrl: '/images/master-200.jpeg' },
  { code: 'YANTRA', imageUrl: '/images/yantra.jpeg' },
];

function dbHost(): string {
  try {
    return new URL(process.env.DATABASE_URL || '').host || 'unknown';
  } catch {
    return 'unknown';
  }
}

async function dump(label: string) {
  const rows = await prisma.machineType.findMany({
    select: { code: true, name: true, imageUrl: true },
    orderBy: { code: 'asc' },
  });
  console.log(`${label}:`);
  for (const m of rows) {
    console.log(`  ${m.code.padEnd(10)} ${(m.name ?? '').padEnd(12)} ${m.imageUrl ?? '(none)'}`);
  }
}

async function main() {
  console.log(`DB host: ${dbHost()}`);
  await dump('Before');

  for (const u of UPDATES) {
    const res = await prisma.machineType.updateMany({
      where: { code: u.code },
      data: { imageUrl: u.imageUrl },
    });
    console.log(`Updated ${u.code}: ${res.count} row(s) -> ${u.imageUrl}`);
  }

  await dump('After');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
