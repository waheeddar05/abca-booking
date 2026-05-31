/**
 * inspect-center.mjs  —  READ-ONLY center configuration dump.
 *
 * Prints the full resource-based configuration of a center (default:
 * Toplay) so it can be used as a template for migrating another center
 * (ABCA) from MACHINE_PITCH to RESOURCE_BASED.
 *
 * It only runs SELECTs — it never writes to the database.
 *
 * Usage (point DATABASE_URL at the DB that has the center, e.g. the uat DB):
 *   DATABASE_URL=postgres://...  node scripts/inspect-center.mjs            # toplay
 *   DATABASE_URL=postgres://...  node scripts/inspect-center.mjs <slug>     # other slug
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const slug = process.argv[2] || 'toplay';

const j = (label, data) => {
  console.log(`\n──────── ${label} ────────`);
  console.log(JSON.stringify(data, (_k, v) => (typeof v === 'bigint' ? Number(v) : v), 2));
};

async function main() {
  const center = await prisma.center.findFirst({
    where: { slug },
    select: {
      id: true, slug: true, name: true, bookingModel: true,
      isActive: true, contactPhone: true, contactEmail: true,
      contactPhones: true, mapUrl: true, address: true,
    },
  });
  if (!center) {
    console.error(`No center with slug "${slug}". Available centers:`);
    const all = await prisma.center.findMany({ select: { slug: true, name: true, bookingModel: true } });
    console.error(JSON.stringify(all, null, 2));
    process.exit(1);
  }
  j('CENTER', center);
  const centerId = center.id;

  const resources = await prisma.resource.findMany({
    where: { centerId },
    orderBy: [{ category: 'asc' }, { displayOrder: 'asc' }],
    select: {
      id: true, name: true, type: true, category: true,
      capacity: true, isActive: true, displayOrder: true, metadata: true,
    },
  });
  j(`RESOURCES (${resources.length})`, resources);

  const machines = await prisma.machine.findMany({
    where: { centerId },
    orderBy: [{ displayOrder: 'asc' }],
    select: {
      id: true, name: true, shortName: true, legacyMachineId: true,
      isActive: true, displayOrder: true,
      supportedPitchTypes: true, supportedBallTypes: true,
      machineType: { select: { code: true, name: true, ballType: true } },
      resource: { select: { name: true, type: true, category: true } },
      metadata: true,
    },
  });
  j(`MACHINES (${machines.length})`, machines);

  const memberships = await prisma.centerMembership.findMany({
    where: { centerId },
    orderBy: [{ role: 'asc' }, { priority: 'asc' }],
    select: {
      role: true, isActive: true, priority: true,
      user: { select: { name: true, email: true, mobileNumber: true } },
    },
  });
  j(`CENTER MEMBERSHIPS (${memberships.length}) — coaches / sidearm / ground-staff / operators / admins`, memberships);

  const policies = await prisma.centerPolicy.findMany({
    where: { centerId },
    orderBy: [{ key: 'asc' }],
    select: { key: true, value: true },
  });
  j(`CENTER POLICIES (${policies.length}) — pricing, enabled categories, pitch types, corporate batch, etc.`, policies);

  // A couple of aggregate counts for context.
  const [resourceCount, machineCount, bookingCount] = await Promise.all([
    prisma.resource.count({ where: { centerId } }),
    prisma.machine.count({ where: { centerId } }),
    prisma.booking.count({ where: { centerId } }),
  ]);
  j('COUNTS', { resourceCount, machineCount, bookingCount });
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
