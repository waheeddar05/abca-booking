-- ──────────────────────────────────────────────────────────────────────
-- Production schema reconciliation (uat → main cutover)
--
-- Production's database is a half-migrated multi-center DB from an earlier
-- attempt: all prior migrations are recorded in _prisma_migrations, but the
-- LIVE schema drifted from prisma/schema.prisma in several ways (captured
-- via `prisma migrate diff`). This migration brings prod in line WITHOUT
-- data loss.
--
-- Every step is idempotent / guarded, so it is a safe no-op on databases
-- that are already in the target state (fresh installs, the uat DB). It
-- only does real work on the drifted production DB.
--
-- Verified against prod data before authoring:
--   • MachineType_archived holds the 3 real machine-type rows; all 4 Machine
--     rows FK to it (0 orphaned) → promote it back to "MachineType".
--   • legacy enum "MachineType" (LEATHER/TENNIS) is used only by
--     Package.machineType → rename it to "PackageMachineType".
--   • Package.pitchTypes is unused (0 of 55 rows populated) → safe to drop.
--   • Only center is ctr_abca → NULL centerId backfills to it.
-- ──────────────────────────────────────────────────────────────────────

-- 1. Backfill NULL centerId (single center: ctr_abca), then enforce NOT NULL.
UPDATE "Booking"                SET "centerId" = 'ctr_abca' WHERE "centerId" IS NULL;
UPDATE "Payment"                SET "centerId" = 'ctr_abca' WHERE "centerId" IS NULL;
UPDATE "Slot"                   SET "centerId" = 'ctr_abca' WHERE "centerId" IS NULL;
UPDATE "Wallet"                 SET "centerId" = 'ctr_abca' WHERE "centerId" IS NULL;
UPDATE "BlockedSlot"            SET "centerId" = 'ctr_abca' WHERE "centerId" IS NULL;
UPDATE "Package"                SET "centerId" = 'ctr_abca' WHERE "centerId" IS NULL;
UPDATE "OperatorAssignment"     SET "centerId" = 'ctr_abca' WHERE "centerId" IS NULL;
UPDATE "PromotionalOffer"       SET "centerId" = 'ctr_abca' WHERE "centerId" IS NULL;
UPDATE "RecurringSlotDiscount"  SET "centerId" = 'ctr_abca' WHERE "centerId" IS NULL;
UPDATE "CashPaymentUser"        SET "centerId" = 'ctr_abca' WHERE "centerId" IS NULL;

ALTER TABLE "BlockedSlot"           ALTER COLUMN "recurringDays" DROP DEFAULT,
                                    ALTER COLUMN "machineIds"    DROP DEFAULT,
                                    ALTER COLUMN "centerId"      SET NOT NULL;
ALTER TABLE "Booking"               ALTER COLUMN "centerId"      SET NOT NULL;
ALTER TABLE "CashPaymentUser"       ALTER COLUMN "centerId"      SET NOT NULL;
ALTER TABLE "OperatorAssignment"    ALTER COLUMN "days"          DROP DEFAULT,
                                    ALTER COLUMN "centerId"      SET NOT NULL;
ALTER TABLE "Payment"               ALTER COLUMN "centerId"      SET NOT NULL;
ALTER TABLE "PromotionalOffer"      ALTER COLUMN "machineIds"    DROP DEFAULT,
                                    ALTER COLUMN "pitchTypes"    DROP DEFAULT,
                                    ALTER COLUMN "centerId"      SET NOT NULL;
ALTER TABLE "RecurringSlotDiscount" ALTER COLUMN "machineIds"    DROP DEFAULT,
                                    ALTER COLUMN "pitchTypes"    DROP DEFAULT,
                                    ALTER COLUMN "centerId"      SET NOT NULL;
ALTER TABLE "Slot"                  ALTER COLUMN "centerId"      SET NOT NULL;
ALTER TABLE "Wallet"                ALTER COLUMN "centerId"      SET NOT NULL;

-- 2. MachineType: rename the legacy enum out of the way, then promote the
--    archived table back to the canonical "MachineType" name. Both renames
--    preserve all rows, indexes and foreign keys. Guarded so this is a
--    no-op where the target shape already exists.
DO $$
BEGIN
  -- 2a. enum "MachineType" (LEATHER/TENNIS) → "PackageMachineType"
  --     (this also retypes Package.machineType automatically, and frees the
  --      "MachineType" name for the table promotion below).
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MachineType' AND typtype = 'e')
     AND NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PackageMachineType') THEN
    ALTER TYPE "MachineType" RENAME TO "PackageMachineType";
  END IF;

  -- 2b. table "MachineType_archived" → "MachineType" (keeps the 3 rows and
  --     the Machine.machineTypeId FK, which follows the table through rename).
  IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = 'MachineType_archived')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = 'MachineType') THEN
    ALTER TABLE "MachineType_archived" RENAME TO "MachineType";
    -- normalize constraint / index names if the archival created suffixed ones
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MachineType_archived_pkey') THEN
      ALTER TABLE "MachineType" RENAME CONSTRAINT "MachineType_archived_pkey" TO "MachineType_pkey";
    END IF;
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'MachineType_archived_code_key') THEN
      ALTER INDEX "MachineType_archived_code_key" RENAME TO "MachineType_code_key";
    END IF;
  END IF;
END $$;

-- 2c. Re-assert the Machine → MachineType FK to the canonical target shape
--     (no-op if already correct; Machine.machineTypeId values are all valid).
ALTER TABLE "Machine" DROP CONSTRAINT IF EXISTS "Machine_machineTypeId_fkey";
ALTER TABLE "Machine" ADD CONSTRAINT "Machine_machineTypeId_fkey"
  FOREIGN KEY ("machineTypeId") REFERENCES "MachineType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. Package: drop the unused pitchTypes column; machineType (now the
--    PackageMachineType enum) is mandatory.
ALTER TABLE "Package" DROP COLUMN IF EXISTS "pitchTypes";
ALTER TABLE "Package" ALTER COLUMN "machineType" SET NOT NULL;

-- 4. Drop stale indexes that are not part of the target schema.
DROP INDEX IF EXISTS "OperatorAssignment_centerId_userId_machineId_key";
DROP INDEX IF EXISTS "Package_machineRowId_idx";
DROP INDEX IF EXISTS "PromotionalOffer_isActive_idx";
DROP INDEX IF EXISTS "PromotionalOffer_startDate_endDate_idx";

-- 5. Refund → Payment FK: align ON DELETE behavior to SET NULL.
ALTER TABLE "Refund" DROP CONSTRAINT IF EXISTS "Refund_paymentId_fkey";
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
