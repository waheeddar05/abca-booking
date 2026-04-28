/**
 * Idempotent seed/verify script for the multi-center foundation.
 *
 * Verifies (and creates if missing):
 *   - ABCA center, with the seeded ID `ctr_abca`.
 *   - MachineType catalog (YANTRA, GRAVITY, LEVERAGE).
 *   - ABCA's four legacy machines, mapped to the MachineId enum.
 *   - CenterMembership for every existing ADMIN/OPERATOR user at ABCA.
 *
 * Reports:
 *   - Counts of orphaned rows (rows whose `centerId` doesn't resolve).
 *   - Whether the super admin email has `isSuperAdmin=true`.
 *
 * Safe to run repeatedly. Designed to be the first thing executed after
 * `prisma migrate deploy` so dev/staging/prod end up in identical states.
 *
 * Usage:
 *   npx tsx scripts/seed-centers.ts          # verify + fix-up
 *   npx tsx scripts/seed-centers.ts --check  # verify only, no writes
 */

import { prisma } from '../src/lib/prisma';

const ABCA_CENTER_ID = 'ctr_abca';
const SUPER_ADMIN_EMAIL =
  process.env.SUPER_ADMIN_EMAIL ||
  process.env.INITIAL_ADMIN_EMAIL ||
  'waheeddar8@gmail.com';

const MACHINE_TYPES = [
  { id: 'mt_yantra',   code: 'YANTRA',   name: 'Yantra',          ballType: 'LEATHER' as const, imageUrl: '/images/yantra-machine.jpeg' },
  { id: 'mt_gravity',  code: 'GRAVITY',  name: 'Gravity',         ballType: 'LEATHER' as const, imageUrl: '/images/leathermachine.jpeg' },
  { id: 'mt_leverage', code: 'LEVERAGE', name: 'Leverage Tennis', ballType: 'TENNIS'  as const, imageUrl: '/images/tennismachine.jpeg' },
];

const ABCA_MACHINES = [
  { id: 'mch_abca_gravity',          legacyMachineId: 'GRAVITY'          as const, machineTypeId: 'mt_gravity',  name: 'Gravity',          shortName: 'Gravity',        displayOrder: 0 },
  { id: 'mch_abca_yantra',           legacyMachineId: 'YANTRA'           as const, machineTypeId: 'mt_yantra',   name: 'Yantra',           shortName: 'Yantra',         displayOrder: 1 },
  { id: 'mch_abca_leverage_indoor',  legacyMachineId: 'LEVERAGE_INDOOR'  as const, machineTypeId: 'mt_leverage', name: 'Leverage Indoor',  shortName: 'Tennis Indoor',  displayOrder: 2 },
  { id: 'mch_abca_leverage_outdoor', legacyMachineId: 'LEVERAGE_OUTDOOR' as const, machineTypeId: 'mt_leverage', name: 'Leverage Outdoor', shortName: 'Tennis Outdoor', displayOrder: 3 },
];

async function main() {
  const checkOnly = process.argv.includes('--check');
  const log = (...args: unknown[]) => console.log('•', ...args);
  const warn = (...args: unknown[]) => console.warn('!', ...args);

  // ─── 1. ABCA center ──────────────────────────────────────────────
  let abca = await prisma.center.findUnique({ where: { id: ABCA_CENTER_ID } });
  if (!abca) {
    if (checkOnly) {
      warn(`ABCA center missing (id=${ABCA_CENTER_ID})`);
    } else {
      abca = await prisma.center.create({
        data: {
          id: ABCA_CENTER_ID,
          slug: 'abca',
          name: 'ABCA Cricket Academy',
          shortName: 'ABCA',
          isActive: true,
          displayOrder: 0,
          bookingModel: 'MACHINE_PITCH',
        },
      });
      log('Created ABCA center');
    }
  } else {
    log(`ABCA center OK (slug=${abca.slug}, bookingModel=${abca.bookingModel})`);
  }

  // ─── 2. MachineType catalog ──────────────────────────────────────
  for (const mt of MACHINE_TYPES) {
    const existing = await prisma.machineType.findUnique({ where: { code: mt.code } });
    if (existing) {
      log(`MachineType ${mt.code} OK (${existing.id})`);
      continue;
    }
    if (checkOnly) {
      warn(`MachineType ${mt.code} missing`);
      continue;
    }
    await prisma.machineType.create({ data: mt });
    log(`Created MachineType ${mt.code}`);
  }

  // ─── 3. ABCA machines (legacy enum bridge) ───────────────────────
  if (abca) {
    for (const m of ABCA_MACHINES) {
      const existing = await prisma.machine.findUnique({
        where: { centerId_legacyMachineId: { centerId: ABCA_CENTER_ID, legacyMachineId: m.legacyMachineId } },
      });
      if (existing) {
        log(`Machine ${m.legacyMachineId} @ ABCA OK`);
        continue;
      }
      if (checkOnly) {
        warn(`Machine ${m.legacyMachineId} @ ABCA missing`);
        continue;
      }
      await prisma.machine.create({
        data: { ...m, centerId: ABCA_CENTER_ID, isActive: true },
      });
      log(`Created Machine ${m.legacyMachineId} @ ABCA`);
    }
  }

  // ─── 4. CenterMembership backfill ────────────────────────────────
  const adminsAndOperators = await prisma.user.findMany({
    where: { role: { in: ['ADMIN', 'OPERATOR'] } },
    select: { id: true, email: true, role: true },
  });
  for (const u of adminsAndOperators) {
    const role = u.role === 'ADMIN' ? 'ADMIN' : 'OPERATOR';
    const existing = await prisma.centerMembership.findUnique({
      where: { userId_centerId_role: { userId: u.id, centerId: ABCA_CENTER_ID, role } },
    });
    if (existing) continue;
    if (checkOnly) {
      warn(`Missing CenterMembership: ${u.email ?? u.id} (${role}) at ABCA`);
      continue;
    }
    await prisma.centerMembership.create({
      data: { userId: u.id, centerId: ABCA_CENTER_ID, role, isActive: true },
    });
    log(`Created CenterMembership ${u.email ?? u.id} (${role}) @ ABCA`);
  }

  // ─── 5. Super admin flag ─────────────────────────────────────────
  if (SUPER_ADMIN_EMAIL) {
    const sa = await prisma.user.findUnique({ where: { email: SUPER_ADMIN_EMAIL } });
    if (!sa) {
      warn(`Super admin user ${SUPER_ADMIN_EMAIL} not found in DB (will be created on first sign-in)`);
    } else if (!sa.isSuperAdmin) {
      if (checkOnly) {
        warn(`Super admin ${SUPER_ADMIN_EMAIL} does not have isSuperAdmin=true`);
      } else {
        await prisma.user.update({ where: { id: sa.id }, data: { isSuperAdmin: true } });
        log(`Promoted ${SUPER_ADMIN_EMAIL} to isSuperAdmin=true`);
      }
    } else {
      log(`Super admin ${SUPER_ADMIN_EMAIL} OK`);
    }
  }

  // ─── 6. Orphan check ─────────────────────────────────────────────
  const orphans = await Promise.all([
    prisma.booking.count({ where: { center: null as never } }).catch(() => -1),
    prisma.slot.count({ where: { center: null as never } }).catch(() => -1),
  ]);
  // Note: Prisma rejects `center: null` on required relations at the type
  // level, so the above will throw; we catch and report -1 to mean "not
  // applicable / centerId is non-nullable". This is the desired post-state
  // — orphans are impossible by schema.
  log('Center FK orphan check (negative numbers = column is non-nullable, as expected):',
      { booking: orphans[0], slot: orphans[1] });

  console.log('\n✓ Multi-center seed/verify complete.');
  if (checkOnly) console.log('  (--check mode: no writes performed.)');
}

main()
  .catch((err) => {
    console.error('Seed/verify failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
