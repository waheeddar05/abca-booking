/**
 * reconcile-migrations.mjs
 *
 * Safely reconciles a database's `_prisma_migrations` table for the
 * uat → main consolidation, WITHOUT re-running schema SQL.
 *
 * Background
 * ──────────
 * `main` (production) and `uat` had unrelated histories. `uat`'s migration
 * set is a strict superset of `main`'s — it adds 13 multi-center /
 * resource-based migrations. During an earlier *failed* Vercel preview
 * build, some of those migrations' SQL was applied to the prod SCHEMA, but
 * because the migration files never existed on `main`, prod's
 * `_prisma_migrations` table has NO rows for them.
 *
 * So when the merged code deploys and the build runs `prisma migrate
 * deploy`, Prisma sees those 13 as "pending" and tries to run their SQL —
 * which fails on the first unguarded `CREATE TYPE` / `ADD COLUMN`
 * ("already exists"), aborting the deploy with prod half-migrated.
 *
 * This script detects, per migration, whether its schema objects already
 * exist. For any migration whose objects exist but isn't recorded, it marks
 * it applied (`prisma migrate resolve --applied`) so the subsequent
 * `migrate deploy` is a clean forward-only run.
 *
 * SAFETY
 * ──────
 *  • DRY RUN by default — prints a plan and the exact commands. Pass
 *    `--apply` to actually run them.
 *  • It ONLY ever runs `prisma migrate resolve`, which writes to the
 *    `_prisma_migrations` tracking table. It NEVER alters real schema.
 *    Marking a migration applied is reversible (delete the tracking row).
 *  • If the foundational migration is found PARTIALLY applied (some objects
 *    present, some missing), it ABORTS — that needs a hand-written
 *    corrective migration, not blind resolution.
 *
 * Usage
 * ─────
 *   # point at the target DB (prod or uat); locally:  vercel env pull
 *   DATABASE_URL=postgres://...  node scripts/reconcile-migrations.mjs
 *   DATABASE_URL=postgres://...  node scripts/reconcile-migrations.mjs --apply
 */

import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';

const APPLY = process.argv.includes('--apply');
const prisma = new PrismaClient();

// ── introspection helpers ────────────────────────────────────────────
async function typeExists(name) {
  const r = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM pg_type WHERE typname = $1 LIMIT 1`, name);
  return r.length > 0;
}
async function tableExists(name) {
  const r = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.tables
       WHERE table_schema='public' AND table_name=$1 LIMIT 1`, name);
  return r.length > 0;
}
async function columnExists(table, col) {
  const r = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name=$1 AND column_name=$2 LIMIT 1`,
    table, col);
  return r.length > 0;
}
async function enumValueExists(typeName, value) {
  const r = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
       WHERE t.typname = $1 AND e.enumlabel = $2 LIMIT 1`, typeName, value);
  return r.length > 0;
}
async function columnIsNullable(table, col) {
  const r = await prisma.$queryRawUnsafe(
    `SELECT is_nullable FROM information_schema.columns
       WHERE table_schema='public' AND table_name=$1 AND column_name=$2 LIMIT 1`,
    table, col);
  return r.length > 0 && r[0].is_nullable === 'YES';
}

// ── the 13 uat-only migrations, each with a sentinel that is true iff
//    the migration's schema changes are present ────────────────────────
const MIGRATIONS = [
  {
    name: '20260427000000_multi_center_foundation',
    // foundational — checked separately for PARTIAL state below
    foundational: true,
  },
  {
    name: '20260427100000_resource_based_bookings',
    check: async () => (await tableExists('BookingResourceAssignment'))
      && (await typeExists('BookingCategory'))
      && (await columnExists('Booking', 'category')),
  },
  { name: '20260428060000_machine_type_image_url',
    check: () => columnExists('MachineType', 'imageUrl') },
  { name: '20260428070000_machine_supported_pitch_ball_types',
    check: () => columnExists('Machine', 'supportedPitchTypes') },
  { name: '20260428080000_booking_category_net',
    check: () => enumValueExists('BookingCategory', 'NET') },
  { name: '20260429000000_rename_sidearm_specialist',
    check: () => enumValueExists('MembershipRole', 'SIDEARM_SPECIALIST') },
  { name: '20260430000000_add_membership_availability',
    check: () => columnExists('CenterMembership', 'availability') },
  { name: '20260507000000_operator_assignment_machine_row',
    check: () => columnExists('OperatorAssignment', 'machineId') },
  { name: '20260507100000_resource_blocks_offers_packages',
    check: () => columnExists('BlockedSlot', 'category') },
  { name: '20260519041233_center_contact_phones',
    check: () => columnExists('Center', 'contactPhones') },
  { name: '20260519140000_sidearm_priority_and_date_availability',
    check: () => columnExists('CenterMembership', 'priority') },
  { name: '20260519160000_add_ground_staff_role',
    check: () => enumValueExists('MembershipRole', 'GROUND_STAFF') },
  { name: '20260520000000_add_netcount_to_blocked_slot',
    check: () => columnExists('BlockedSlot', 'netCount') },
  { name: '20260528000000_make_userpackage_dates_nullable',
    check: () => columnIsNullable('UserPackage', 'startDate') },
];

// objects created by multi_center_foundation — for all-or-nothing detection
const FOUNDATION_TYPES  = ['BookingModel', 'MembershipRole', 'ResourceType', 'ResourceCategory'];
const FOUNDATION_TABLES = ['Center', 'CenterMembership', 'Resource', 'MachineType', 'Machine', 'CenterPolicy'];

async function classifyFoundation() {
  const present = [];
  const missing = [];
  for (const t of FOUNDATION_TYPES)  ((await typeExists(t))  ? present : missing).push(`type:${t}`);
  for (const t of FOUNDATION_TABLES) ((await tableExists(t)) ? present : missing).push(`table:${t}`);
  ((await columnExists('Booking', 'centerId')) ? present : missing).push('col:Booking.centerId');
  if (missing.length === 0) return { state: 'present', present, missing };
  if (present.length === 0) return { state: 'absent', present, missing };
  return { state: 'partial', present, missing };
}

async function recordedMigrations() {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"`);
  const set = new Set();
  for (const r of rows) {
    if (r.finished_at && !r.rolled_back_at) set.add(r.migration_name);
  }
  return set;
}

function resolveApplied(name) {
  console.log(`   → npx prisma migrate resolve --applied ${name}`);
  if (APPLY) {
    execSync(`npx prisma migrate resolve --applied ${name}`, { stdio: 'inherit' });
  }
}

async function main() {
  console.log(`\n=== Prisma migration reconciliation (${APPLY ? 'APPLY' : 'DRY RUN'}) ===\n`);

  const recorded = await recordedMigrations();
  console.log(`Recorded-applied migrations in this DB: ${recorded.size}\n`);

  // 1. Foundational migration — must be all-or-nothing.
  const f = await classifyFoundation();
  const foundName = '20260427000000_multi_center_foundation';
  const foundRecorded = recorded.has(foundName);

  console.log(`multi_center_foundation: schema=${f.state}, recorded=${foundRecorded}`);
  if (f.state === 'partial') {
    console.error('\n❌ ABORT: multi_center_foundation is PARTIALLY applied.');
    console.error('   present:', f.present.join(', '));
    console.error('   MISSING:', f.missing.join(', '));
    console.error('\n   This needs a hand-written corrective migration (prisma migrate diff)');
    console.error('   to add the missing objects — do NOT mark it applied blindly.');
    process.exit(2);
  }

  const toResolve = [];
  if (f.state === 'present' && !foundRecorded) toResolve.push(foundName);

  // 2. The other 12.
  for (const m of MIGRATIONS) {
    if (m.foundational) continue;
    const present = await m.check();
    const isRecorded = recorded.has(m.name);
    const tag = isRecorded ? 'recorded' : (present ? 'NEEDS-RESOLVE' : 'will-deploy');
    console.log(`  ${m.name.padEnd(52)} schema=${present ? 'present' : 'absent '} ${tag}`);
    if (present && !isRecorded) toResolve.push(m.name);
  }

  console.log('');
  if (toResolve.length === 0) {
    console.log('✅ Nothing to reconcile — migrate deploy will be clean as-is.');
  } else {
    console.log(`${APPLY ? 'Resolving' : 'WOULD resolve'} ${toResolve.length} migration(s) as applied (schema already present):\n`);
    // keep chronological order
    toResolve.sort();
    for (const name of toResolve) resolveApplied(name);
    if (!APPLY) {
      console.log('\n(DRY RUN — re-run with --apply to execute the above.)');
    } else {
      console.log('\n✅ Reconciliation applied. Now run: npx prisma migrate deploy');
    }
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
