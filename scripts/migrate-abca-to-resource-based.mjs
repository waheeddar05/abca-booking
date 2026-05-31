/**
 * migrate-abca-to-resource-based.mjs
 *
 * Migrates ABCA (ctr_abca) from MACHINE_PITCH to RESOURCE_BASED booking model.
 * Currently enables MACHINE category only.
 *
 * What this script does (idempotent — safe to re-run):
 *   1. Creates 6 Resource rows (4 indoor NETs, 2 outdoor NETs) for ABCA.
 *   2. Links each machine to its dedicated net (Machine.resourceId).
 *   3. Sets Machine.supportedBallTypes if not already set.
 *   4. Writes CenterPolicy rows:
 *        ENABLED_BOOKING_CATEGORIES, RESOURCE_PRICING_CONFIG, TIME_SLAB_CONFIG
 *   5. Backfills future bookings:
 *        - Booking.assignedMachineId = machine row ID (from legacy machineId enum)
 *        - BookingResourceAssignment rows (booking → net)
 *   6. Flips Center.bookingModel = RESOURCE_BASED.
 *
 * Usage (against prod — maintenance window must be open):
 *   DATABASE_URL="<prod-url>" node scripts/migrate-abca-to-resource-based.mjs
 *   DATABASE_URL="<prod-url>" node scripts/migrate-abca-to-resource-based.mjs --dry-run
 *   DATABASE_URL="<prod-url>" node scripts/migrate-abca-to-resource-based.mjs --check
 *
 * Flags:
 *   --dry-run   print every SQL/action without executing writes.
 *   --check     same as --dry-run but exits non-zero if migration is needed.
 */

import { PrismaClient } from '@prisma/client';

const DRY_RUN = process.argv.includes('--dry-run') || process.argv.includes('--check');
const CHECK   = process.argv.includes('--check');

const prisma = new PrismaClient();
const q = (sql, ...args) => prisma.$queryRawUnsafe(sql, ...args);

// ─── Stable IDs (must match seed-centers.ts) ─────────────────────────────────
const ABCA = 'ctr_abca';

const MACHINES = {
  GRAVITY:          { id: 'mch_abca_gravity',          net: 'res_abca_indoor_1',  ballTypes: ['MACHINE','LEATHER'] },
  YANTRA:           { id: 'mch_abca_yantra',           net: 'res_abca_indoor_2',  ballTypes: ['MACHINE','LEATHER'] },
  LEVERAGE_INDOOR:  { id: 'mch_abca_leverage_indoor',  net: 'res_abca_indoor_3',  ballTypes: ['TENNIS'] },
  LEVERAGE_OUTDOOR: { id: 'mch_abca_leverage_outdoor', net: 'res_abca_outdoor_1', ballTypes: ['TENNIS'] },
};

const RESOURCES = [
  // Indoor nets — 4 total; 3 have machines, 1 spare
  { id: 'res_abca_indoor_1', name: 'Indoor Net - 1', type: 'NET', category: 'INDOOR',  displayOrder: 0 },
  { id: 'res_abca_indoor_2', name: 'Indoor Net - 2', type: 'NET', category: 'INDOOR',  displayOrder: 1 },
  { id: 'res_abca_indoor_3', name: 'Indoor Net - 3', type: 'NET', category: 'INDOOR',  displayOrder: 2 },
  { id: 'res_abca_indoor_4', name: 'Indoor Net - 4', type: 'NET', category: 'INDOOR',  displayOrder: 3 },
  // Outdoor nets — 2 total; 1 has machine, 1 spare
  { id: 'res_abca_outdoor_1', name: 'Outdoor Net - 1', type: 'NET', category: 'OUTDOOR', displayOrder: 0 },
  { id: 'res_abca_outdoor_2', name: 'Outdoor Net - 2', type: 'NET', category: 'OUTDOOR', displayOrder: 1 },
];

// ─── Pricing: ported from DEFAULT_PRICING_CONFIG in pricing.ts ────────────────
//   machineRowPricing is keyed by Machine.id → pitch → ball → slab → {single,consecutive}
//   Gravity  = leather/machine tiers  (leather pricing)
//   Yantra   = yantra/yantra_machine  (premium leather pricing)
//   Leverage = tennis tier
const RESOURCE_PRICING_CONFIG = {
  categoryRates: {
    MACHINE: { morning: 500, evening: 600 },
  },
  machineTypeOverrides: {},
  machinePricing: {},
  machineRowPricing: {
    'mch_abca_gravity': {
      ASTRO:   { LEATHER: { morning: { single: 600, consecutive: 1000 }, evening: { single: 700, consecutive: 1200 } },
                 MACHINE: { morning: { single: 500, consecutive:  800 }, evening: { single: 600, consecutive: 1000 } } },
      CEMENT:  { LEATHER: { morning: { single: 600, consecutive: 1000 }, evening: { single: 700, consecutive: 1200 } },
                 MACHINE: { morning: { single: 500, consecutive:  800 }, evening: { single: 600, consecutive: 1000 } } },
      NATURAL: { LEATHER: { morning: { single: 600, consecutive: 1000 }, evening: { single: 700, consecutive: 1200 } },
                 MACHINE: { morning: { single: 500, consecutive:  800 }, evening: { single: 600, consecutive: 1000 } } },
    },
    'mch_abca_yantra': {
      ASTRO:   { LEATHER: { morning: { single: 700, consecutive: 1200 }, evening: { single: 800, consecutive: 1400 } },
                 MACHINE: { morning: { single: 600, consecutive: 1000 }, evening: { single: 700, consecutive: 1200 } } },
      CEMENT:  { LEATHER: { morning: { single: 700, consecutive: 1200 }, evening: { single: 800, consecutive: 1400 } },
                 MACHINE: { morning: { single: 600, consecutive: 1000 }, evening: { single: 700, consecutive: 1200 } } },
      NATURAL: { LEATHER: { morning: { single: 700, consecutive: 1200 }, evening: { single: 800, consecutive: 1400 } },
                 MACHINE: { morning: { single: 600, consecutive: 1000 }, evening: { single: 700, consecutive: 1200 } } },
    },
    'mch_abca_leverage_indoor': {
      ASTRO:   { TENNIS: { morning: { single: 500, consecutive: 800 }, evening: { single: 600, consecutive: 1000 } } },
      CEMENT:  { TENNIS: { morning: { single: 550, consecutive: 900 }, evening: { single: 650, consecutive: 1100 } } },
      NATURAL: { TENNIS: { morning: { single: 550, consecutive: 900 }, evening: { single: 650, consecutive: 1100 } } },
    },
    'mch_abca_leverage_outdoor': {
      ASTRO:   { TENNIS: { morning: { single: 500, consecutive: 800 }, evening: { single: 600, consecutive: 1000 } } },
      CEMENT:  { TENNIS: { morning: { single: 550, consecutive: 900 }, evening: { single: 650, consecutive: 1100 } } },
      NATURAL: { TENNIS: { morning: { single: 550, consecutive: 900 }, evening: { single: 650, consecutive: 1100 } } },
    },
  },
};

const ENABLED_CATEGORIES = ['MACHINE'];

// TIME_SLAB_CONFIG — use ABCA's existing global Policy value if present,
// otherwise fall back to the platform default.
// We'll read it at runtime (see step 4).

// ─── Helpers ──────────────────────────────────────────────────────────────────
let needsMigration = false;

function log(msg)  { console.log('  ✓', msg); }
function warn(msg) { console.warn('  !', msg); needsMigration = true; }
function dry(msg)  { console.log(' DRY', msg); needsMigration = true; }

async function exec(description, sql, ...args) {
  if (DRY_RUN) { dry(description); return; }
  await q(sql, ...args);
  log(description);
}

async function upsertPolicy(key, value) {
  const strVal = JSON.stringify(value);
  if (DRY_RUN) { dry(`CenterPolicy[${key}] = ${strVal.substring(0, 80)}...`); return; }
  await q(`
    INSERT INTO "CenterPolicy" (id, "centerId", key, value, "updatedAt")
    VALUES (gen_random_uuid()::text, $1, $2, $3, NOW())
    ON CONFLICT ("centerId", key) DO UPDATE SET value=EXCLUDED.value, "updatedAt"=NOW()
  `, ABCA, key, strVal);
  log(`CenterPolicy[${key}] upserted`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('='.repeat(60));
  console.log(`ABCA → RESOURCE_BASED migration  [${DRY_RUN ? 'DRY RUN' : 'LIVE'}]`);
  console.log('='.repeat(60));

  // ── Verify ABCA center ──
  const [center] = await q(`SELECT id, "bookingModel" FROM "Center" WHERE id=$1`, ABCA);
  if (!center) throw new Error('ABCA center not found — check DATABASE_URL');
  console.log(`\nCenter bookingModel: ${center.bookingModel}`);
  if (center.bookingModel === 'RESOURCE_BASED') {
    log('bookingModel already RESOURCE_BASED');
  }

  // ── Step 1: Resources ────────────────────────────────────────────────────────
  console.log('\n── Step 1: Create Resources ──');
  for (const r of RESOURCES) {
    const [existing] = await q(`SELECT id FROM "Resource" WHERE id=$1`, r.id);
    if (existing) { log(`Resource ${r.id} (${r.name}) already exists`); continue; }
    await exec(
      `Create Resource ${r.id} (${r.name})`,
      `INSERT INTO "Resource" (id, "centerId", name, type, category, capacity, "isActive", "displayOrder", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4::"ResourceType", $5::"ResourceCategory", 1, true, $6, NOW(), NOW())`,
      r.id, ABCA, r.name, r.type, r.category, r.displayOrder
    );
  }

  // ── Step 2: Link machines → nets ─────────────────────────────────────────────
  console.log('\n── Step 2: Link Machines → Nets ──');
  for (const [legacyId, cfg] of Object.entries(MACHINES)) {
    const [m] = await q(`SELECT id, "resourceId", "supportedBallTypes" FROM "Machine" WHERE id=$1`, cfg.id);
    if (!m) { warn(`Machine ${cfg.id} (${legacyId}) NOT FOUND in DB — skipping`); continue; }

    if (m.resourceId !== cfg.net) {
      await exec(
        `Machine ${cfg.id} → resourceId=${cfg.net}`,
        `UPDATE "Machine" SET "resourceId"=$1, "updatedAt"=NOW() WHERE id=$2`,
        cfg.net, cfg.id
      );
    } else {
      log(`Machine ${cfg.id} resourceId already set`);
    }

    // Set supportedBallTypes if not already correct
    const currentBallTypes = Array.isArray(m.supportedBallTypes) ? m.supportedBallTypes : [];
    const needed = cfg.ballTypes.every(bt => currentBallTypes.includes(bt));
    if (!needed) {
      // Cast as PG enum array literal e.g. '{MACHINE,LEATHER}'
      const pgArrayLiteral = `{${cfg.ballTypes.join(',')}}`;
      await exec(
        `Machine ${cfg.id} supportedBallTypes → ${JSON.stringify(cfg.ballTypes)}`,
        `UPDATE "Machine" SET "supportedBallTypes"=$1::"BallType"[], "updatedAt"=NOW() WHERE id=$2`,
        pgArrayLiteral, cfg.id
      );
    } else {
      log(`Machine ${cfg.id} supportedBallTypes already set`);
    }
  }

  // ── Step 3: CenterPolicy rows ────────────────────────────────────────────────
  console.log('\n── Step 3: Write CenterPolicy rows ──');

  // Inherit TIME_SLAB_CONFIG from global Policy if available, else use default
  const [globalSlab] = await q(`SELECT value FROM "Policy" WHERE key='TIME_SLAB_CONFIG'`);
  const [existingSlab] = await q(`SELECT value FROM "CenterPolicy" WHERE "centerId"=$1 AND key='TIME_SLAB_CONFIG'`, ABCA);
  if (!existingSlab) {
    const slabValue = globalSlab
      ? JSON.parse(globalSlab.value)
      : { morning: { start: '07:00', end: '17:00' }, evening: { start: '17:00', end: '22:30' } };
    await upsertPolicy('TIME_SLAB_CONFIG', slabValue);
  } else {
    log('CenterPolicy[TIME_SLAB_CONFIG] already set');
  }

  await upsertPolicy('ENABLED_BOOKING_CATEGORIES', ENABLED_CATEGORIES);
  await upsertPolicy('RESOURCE_PRICING_CONFIG', RESOURCE_PRICING_CONFIG);

  // ── Step 4: Backfill future bookings ─────────────────────────────────────────
  console.log('\n── Step 4: Backfill future bookings ──');

  // Build legacy enum → machine row ID map
  const legacyToMachineId = Object.fromEntries(
    Object.entries(MACHINES).map(([legacyId, cfg]) => [legacyId, cfg.id])
  );
  // Build machine row ID → net resource ID map
  const machineToNet = Object.fromEntries(
    Object.entries(MACHINES).map(([, cfg]) => [cfg.id, cfg.net])
  );

  const futureBookings = await q(`
    SELECT id, "machineId", "assignedMachineId"
    FROM "Booking"
    WHERE "centerId"=$1
      AND date >= CURRENT_DATE
      AND status != 'CANCELLED'
      AND "machineId" IS NOT NULL
  `, ABCA);

  console.log(`  Found ${futureBookings.length} future bookings to check`);

  let assignedMachineUpdates = 0;
  let raInserts = 0;

  for (const bk of futureBookings) {
    const machineRowId = legacyToMachineId[bk.machineId];
    if (!machineRowId) { warn(`Unknown legacy machineId ${bk.machineId} on booking ${bk.id}`); continue; }
    const netId = machineToNet[machineRowId];
    if (!netId) { warn(`No net mapped for machine ${machineRowId}`); continue; }

    // Set assignedMachineId if not already set
    if (bk.assignedMachineId !== machineRowId) {
      await exec(
        `Booking ${bk.id}: assignedMachineId → ${machineRowId}`,
        `UPDATE "Booking" SET "assignedMachineId"=$1 WHERE id=$2`,
        machineRowId, bk.id
      );
      assignedMachineUpdates++;
    }

    // Insert BookingResourceAssignment if missing
    const [existingRA] = await q(
      `SELECT id FROM "BookingResourceAssignment" WHERE "bookingId"=$1 AND "resourceId"=$2`,
      bk.id, netId
    );
    if (!existingRA) {
      await exec(
        `BookingResourceAssignment: booking ${bk.id} → net ${netId}`,
        `INSERT INTO "BookingResourceAssignment" (id, "bookingId", "resourceId", "createdAt")
         VALUES (gen_random_uuid()::text, $1, $2, NOW())
         ON CONFLICT ("bookingId","resourceId") DO NOTHING`,
        bk.id, netId
      );
      raInserts++;
    }
  }

  if (!DRY_RUN) {
    log(`assignedMachineId updated: ${assignedMachineUpdates}`);
    log(`BookingResourceAssignment inserted: ${raInserts}`);
  }

  // ── Step 5: Flip bookingModel ────────────────────────────────────────────────
  console.log('\n── Step 5: Flip bookingModel ──');
  if (center.bookingModel !== 'RESOURCE_BASED') {
    await exec(
      `Center ${ABCA}: bookingModel → RESOURCE_BASED`,
      `UPDATE "Center" SET "bookingModel"='RESOURCE_BASED', "updatedAt"=NOW() WHERE id=$1`,
      ABCA
    );
  } else {
    log('bookingModel already RESOURCE_BASED');
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(60));
  if (DRY_RUN) {
    console.log(needsMigration
      ? `DRY RUN complete — migration IS needed.`
      : `DRY RUN complete — nothing to do (already migrated).`);
    if (CHECK && needsMigration) process.exit(1);
  } else {
    console.log('Migration complete. Verify via bypass URL, then lift maintenance.');
  }
}

main()
  .catch(e => { console.error('\nFATAL:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
