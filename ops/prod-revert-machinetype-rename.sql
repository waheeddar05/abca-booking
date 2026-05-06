-- ─────────────────────────────────────────────────────────────────────
-- ONE-OFF PROD REPAIR — revert the MachineType enum rename
-- ─────────────────────────────────────────────────────────────────────
-- Context
--   The 20260427000000_multi_center_foundation migration was applied
--   to the prod DB by accident (a UAT preview deploy was pointed at
--   prod). That migration:
--       ALTER TYPE "MachineType" RENAME TO "PackageMachineType";
--       CREATE TABLE "MachineType" (...);
--   Prod's *code* (Prisma client) was generated against the schema
--   that still calls the enum "MachineType". The result: every query
--   that writes Package.machineType errors with
--       column "machineType" is of type "PackageMachineType"
--       but expression is of type "MachineType"
--   ...which has been silently breaking SLOT_BOOKING flows and
--   producing the "user paid but no booking" tickets.
--
-- What this script does — and doesn't do
--   ✓ Renames the new MachineType TABLE out of the way (preserving
--     its rows under MachineType_archived) so the enum can reclaim
--     the name 'MachineType'.
--   ✓ Renames the enum back: PackageMachineType -> MachineType.
--   ✗ Does NOT drop any data. Every row in every table is preserved.
--   ✗ Does NOT touch _prisma_migrations bookkeeping. The migration
--     row stays "applied"; future `prisma migrate deploy` is a no-op.
--   ✗ Does NOT remove other multi-center additions (Center,
--     CenterMembership, Resource, Machine, CenterPolicy, centerId
--     columns, new enums). Prod's Prisma client doesn't reference
--     any of them, so they're inert. Leaving them in place keeps
--     blast radius minimal and makes a future multi-center promotion
--     to prod easier.
--
-- Safety
--   ✓ Single transaction — either everything renames or nothing does.
--   ✓ Uses IF EXISTS guards so a partial state doesn't error out.
--   ✓ All operations are metadata (catalog) renames — zero rows touched.
--
-- How to run
--   Option A (recommended): Neon Console → your prod project → SQL
--     Editor → paste this whole file → Run. Confirm result is
--     "ALTER TABLE / ALTER INDEX / ALTER TYPE / COMMIT" with no errors.
--   Option B: psql against prod DATABASE_URL:
--       psql "$PROD_DATABASE_URL" -f ops/prod-revert-machinetype-rename.sql
--
-- Before running
--   1. Take a Neon snapshot/branch off main at "now". This is your
--      rollback button. Neon Console → Branches → Create branch.
--   2. Confirm UAT/test runs on a *different* Neon project — uat code
--      requires `PackageMachineType` and will break if you run this
--      against the wrong DB.
--   3. Have a Vercel rollback ready for prod just in case.
--
-- After running
--   - Prod's `column "machineType" is of type "PackageMachineType"...`
--     errors should stop on the next request.
--   - Use the new admin tool at /admin/payments/orphans to retry or
--     refund any captured-but-not-booked payments from the last 30
--     days (Anmol Warikoo, Piyush Patil, etc.).
--   - Monitor Vercel logs for a few hours. If anything else surfaces
--     (e.g. a query referencing one of the new columns/tables that
--     I missed), restore the Neon snapshot and ping me.

BEGIN;

-- 1. Get the new MachineType table out of the way. Keep all rows —
--    we just rename it. If you later promote multi-center work to
--    prod, you can rename it back or merge as needed.
ALTER TABLE IF EXISTS "MachineType"          RENAME TO "MachineType_archived";
ALTER INDEX IF EXISTS "MachineType_pkey"     RENAME TO "MachineType_archived_pkey";
ALTER INDEX IF EXISTS "MachineType_code_key" RENAME TO "MachineType_archived_code_key";

-- 2. Rename the enum back to its original name. This is what fixes
--    the production error. No data moves; every existing
--    Package.machineType value (LEATHER / TENNIS) is unaffected.
ALTER TYPE "PackageMachineType" RENAME TO "MachineType";

COMMIT;

-- Sanity check (non-destructive). Run after the COMMIT to verify:
--   SELECT typname FROM pg_type WHERE typname IN ('MachineType','PackageMachineType');
--   -- expect a single row with typname = 'MachineType'
--
--   SELECT to_regclass('"MachineType_archived"');
--   -- expect "MachineType_archived" (the renamed table is reachable)
