-- ──────────────────────────────────────────────────────────────────────
-- Multi-Center Foundation
--
-- Introduces Center, CenterMembership, Resource, MachineType, Machine,
-- CenterPolicy. Adds centerId to all center-scoped domain tables, seeds
-- the existing ABCA center, backfills every existing row to ABCA, and
-- swaps unique constraints to be center-scoped.
--
-- This migration is designed to be safe on production data: it runs in a
-- single transaction (Prisma default), it backfills before NOT-NULL is
-- applied, and the legacy MachineId enum and existing Booking/Slot rows
-- are not modified beyond gaining a centerId.
-- ──────────────────────────────────────────────────────────────────────

-- ───── 1. New enums ─────────────────────────────────────────────────

CREATE TYPE "BookingModel" AS ENUM ('MACHINE_PITCH', 'RESOURCE_BASED');
CREATE TYPE "MembershipRole" AS ENUM ('ADMIN', 'OPERATOR', 'COACH', 'SIDEARM_STAFF');
CREATE TYPE "ResourceType" AS ENUM ('NET', 'TURF_WICKET', 'CEMENT_WICKET', 'COURT');
CREATE TYPE "ResourceCategory" AS ENUM ('INDOOR', 'OUTDOOR');

-- Extend UserRole with COACH and SIDEARM_STAFF.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'COACH';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SIDEARM_STAFF';

-- Rename the Package machine-type enum to free up the bare `MachineType`
-- name for the new model. The Postgres enum is renamed in place — all
-- existing column types (Package.machineType) auto-update, no data moves.
ALTER TYPE "MachineType" RENAME TO "PackageMachineType";

-- ───── 2. User: persistent super-admin flag ─────────────────────────

ALTER TABLE "User"
  ADD COLUMN "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false;

-- Bootstrap: promote the project's super admin if the user already
-- exists. Idempotent — no-op if the user record hasn't been created yet
-- (their first Google sign-in will create the row, and a follow-up step
-- in src/lib/authOptions.ts re-applies the flag based on env).
UPDATE "User"
   SET "isSuperAdmin" = true
 WHERE "email" = 'waheeddar8@gmail.com';

-- ───── 3. Center, CenterMembership, Resource, MachineType, Machine ──

CREATE TABLE "Center" (
  "id"                    TEXT NOT NULL,
  "slug"                  TEXT NOT NULL,
  "name"                  TEXT NOT NULL,
  "shortName"             TEXT,
  "description"           TEXT,
  "isActive"              BOOLEAN NOT NULL DEFAULT true,
  "displayOrder"          INTEGER NOT NULL DEFAULT 0,
  "bookingModel"          "BookingModel" NOT NULL DEFAULT 'MACHINE_PITCH',
  "addressLine1"          TEXT,
  "addressLine2"          TEXT,
  "city"                  TEXT,
  "state"                 TEXT,
  "pincode"               TEXT,
  "latitude"              DOUBLE PRECISION,
  "longitude"             DOUBLE PRECISION,
  "contactPhone"          TEXT,
  "contactEmail"          TEXT,
  "mapUrl"                TEXT,
  "logoUrl"               TEXT,
  "themeColor"            TEXT,
  "razorpayKeyId"         TEXT,
  "razorpayKeySecret"     TEXT,
  "razorpayWebhookSecret" TEXT,
  "metadata"              JSONB,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Center_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Center_slug_key" ON "Center"("slug");

CREATE TABLE "CenterMembership" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "centerId"  TEXT NOT NULL,
  "role"      "MembershipRole" NOT NULL,
  "isActive"  BOOLEAN NOT NULL DEFAULT true,
  "metadata"  JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CenterMembership_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CenterMembership_userId_centerId_role_key"
  ON "CenterMembership"("userId", "centerId", "role");
CREATE INDEX "CenterMembership_centerId_role_idx"
  ON "CenterMembership"("centerId", "role");
CREATE INDEX "CenterMembership_userId_idx"
  ON "CenterMembership"("userId");

ALTER TABLE "CenterMembership"
  ADD CONSTRAINT "CenterMembership_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CenterMembership"
  ADD CONSTRAINT "CenterMembership_centerId_fkey"
  FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Resource" (
  "id"           TEXT NOT NULL,
  "centerId"     TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "type"         "ResourceType" NOT NULL,
  "category"     "ResourceCategory" NOT NULL,
  "capacity"     INTEGER NOT NULL DEFAULT 1,
  "isActive"     BOOLEAN NOT NULL DEFAULT true,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "metadata"     JSONB,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Resource_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Resource_centerId_type_idx"     ON "Resource"("centerId", "type");
CREATE INDEX "Resource_centerId_isActive_idx" ON "Resource"("centerId", "isActive");

ALTER TABLE "Resource"
  ADD CONSTRAINT "Resource_centerId_fkey"
  FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MachineType" (
  "id"          TEXT NOT NULL,
  "code"        TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "ballType"    "BallType" NOT NULL,
  "description" TEXT,
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "metadata"    JSONB,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MachineType_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MachineType_code_key" ON "MachineType"("code");

CREATE TABLE "Machine" (
  "id"              TEXT NOT NULL,
  "centerId"        TEXT NOT NULL,
  "machineTypeId"   TEXT NOT NULL,
  "legacyMachineId" "MachineId",
  "name"            TEXT NOT NULL,
  "shortName"       TEXT,
  "resourceId"      TEXT,
  "isActive"        BOOLEAN NOT NULL DEFAULT true,
  "displayOrder"    INTEGER NOT NULL DEFAULT 0,
  "metadata"        JSONB,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Machine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Machine_centerId_legacyMachineId_key"
  ON "Machine"("centerId", "legacyMachineId");
CREATE INDEX "Machine_centerId_isActive_idx" ON "Machine"("centerId", "isActive");

ALTER TABLE "Machine"
  ADD CONSTRAINT "Machine_centerId_fkey"
  FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Machine"
  ADD CONSTRAINT "Machine_machineTypeId_fkey"
  FOREIGN KEY ("machineTypeId") REFERENCES "MachineType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Machine"
  ADD CONSTRAINT "Machine_resourceId_fkey"
  FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "CenterPolicy" (
  "id"        TEXT NOT NULL,
  "centerId"  TEXT NOT NULL,
  "key"       TEXT NOT NULL,
  "value"     TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CenterPolicy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CenterPolicy_centerId_key_key"
  ON "CenterPolicy"("centerId", "key");
CREATE INDEX "CenterPolicy_key_idx" ON "CenterPolicy"("key");

ALTER TABLE "CenterPolicy"
  ADD CONSTRAINT "CenterPolicy_centerId_fkey"
  FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ───── 4. Seed: ABCA center + MachineType catalog + ABCA machines ──

-- Use deterministic IDs so subsequent migrations / scripts can reference
-- them without a lookup. Format: cm_<purpose>_<key>.
INSERT INTO "Center" (
  "id", "slug", "name", "shortName", "isActive", "displayOrder",
  "bookingModel", "city", "createdAt", "updatedAt"
) VALUES (
  'ctr_abca', 'abca', 'ABCA Cricket Academy', 'ABCA', true, 0,
  'MACHINE_PITCH', NULL, NOW(), NOW()
);

INSERT INTO "MachineType" ("id", "code", "name", "ballType", "createdAt", "updatedAt") VALUES
  ('mt_yantra',   'YANTRA',   'Yantra',           'LEATHER', NOW(), NOW()),
  ('mt_gravity',  'GRAVITY',  'Gravity',          'LEATHER', NOW(), NOW()),
  ('mt_leverage', 'LEVERAGE', 'Leverage Tennis',  'TENNIS',  NOW(), NOW());

-- Seed ABCA's four legacy machines as Machine rows so future code can
-- reference them by Machine.id while existing code keeps using the
-- MachineId enum.
INSERT INTO "Machine" (
  "id", "centerId", "machineTypeId", "legacyMachineId",
  "name", "shortName", "isActive", "displayOrder",
  "createdAt", "updatedAt"
) VALUES
  ('mch_abca_gravity',          'ctr_abca', 'mt_gravity',  'GRAVITY',          'Gravity',          'Gravity',        true, 0, NOW(), NOW()),
  ('mch_abca_yantra',           'ctr_abca', 'mt_yantra',   'YANTRA',           'Yantra',           'Yantra',         true, 1, NOW(), NOW()),
  ('mch_abca_leverage_indoor',  'ctr_abca', 'mt_leverage', 'LEVERAGE_INDOOR',  'Leverage Indoor',  'Tennis Indoor',  true, 2, NOW(), NOW()),
  ('mch_abca_leverage_outdoor', 'ctr_abca', 'mt_leverage', 'LEVERAGE_OUTDOOR', 'Leverage Outdoor', 'Tennis Outdoor', true, 3, NOW(), NOW());

-- Backfill CenterMembership for every existing ADMIN and OPERATOR so the
-- center-scoped auth helper has rows to read on day one.
INSERT INTO "CenterMembership" ("id", "userId", "centerId", "role", "isActive", "createdAt", "updatedAt")
SELECT 'cmem_' || u."id" || '_abca_admin',
       u."id", 'ctr_abca', 'ADMIN', true, NOW(), NOW()
  FROM "User" u
 WHERE u."role" = 'ADMIN'
ON CONFLICT ("userId", "centerId", "role") DO NOTHING;

INSERT INTO "CenterMembership" ("id", "userId", "centerId", "role", "isActive", "createdAt", "updatedAt")
SELECT 'cmem_' || u."id" || '_abca_operator',
       u."id", 'ctr_abca', 'OPERATOR', true, NOW(), NOW()
  FROM "User" u
 WHERE u."role" = 'OPERATOR'
ON CONFLICT ("userId", "centerId", "role") DO NOTHING;

-- ───── 5. Add centerId to existing tables (nullable, then backfill) ─

ALTER TABLE "Slot"                  ADD COLUMN "centerId" TEXT;
ALTER TABLE "Booking"               ADD COLUMN "centerId" TEXT;
ALTER TABLE "Package"               ADD COLUMN "centerId" TEXT;
ALTER TABLE "BlockedSlot"           ADD COLUMN "centerId" TEXT;
ALTER TABLE "OperatorAssignment"    ADD COLUMN "centerId" TEXT;
ALTER TABLE "Payment"               ADD COLUMN "centerId" TEXT;
ALTER TABLE "PromotionalOffer"      ADD COLUMN "centerId" TEXT;
ALTER TABLE "RecurringSlotDiscount" ADD COLUMN "centerId" TEXT;
ALTER TABLE "CashPaymentUser"       ADD COLUMN "centerId" TEXT;
ALTER TABLE "Wallet"                ADD COLUMN "centerId" TEXT;

-- Every existing row predates multi-center support → assign to ABCA.
UPDATE "Slot"                  SET "centerId" = 'ctr_abca' WHERE "centerId" IS NULL;
UPDATE "Booking"               SET "centerId" = 'ctr_abca' WHERE "centerId" IS NULL;
UPDATE "Package"               SET "centerId" = 'ctr_abca' WHERE "centerId" IS NULL;
UPDATE "BlockedSlot"           SET "centerId" = 'ctr_abca' WHERE "centerId" IS NULL;
UPDATE "OperatorAssignment"    SET "centerId" = 'ctr_abca' WHERE "centerId" IS NULL;
UPDATE "Payment"               SET "centerId" = 'ctr_abca' WHERE "centerId" IS NULL;
UPDATE "PromotionalOffer"      SET "centerId" = 'ctr_abca' WHERE "centerId" IS NULL;
UPDATE "RecurringSlotDiscount" SET "centerId" = 'ctr_abca' WHERE "centerId" IS NULL;
UPDATE "CashPaymentUser"       SET "centerId" = 'ctr_abca' WHERE "centerId" IS NULL;
UPDATE "Wallet"                SET "centerId" = 'ctr_abca' WHERE "centerId" IS NULL;

-- Now lock the columns.
ALTER TABLE "Slot"                  ALTER COLUMN "centerId" SET NOT NULL;
ALTER TABLE "Booking"               ALTER COLUMN "centerId" SET NOT NULL;
ALTER TABLE "Package"               ALTER COLUMN "centerId" SET NOT NULL;
ALTER TABLE "BlockedSlot"           ALTER COLUMN "centerId" SET NOT NULL;
ALTER TABLE "OperatorAssignment"    ALTER COLUMN "centerId" SET NOT NULL;
ALTER TABLE "Payment"               ALTER COLUMN "centerId" SET NOT NULL;
ALTER TABLE "PromotionalOffer"      ALTER COLUMN "centerId" SET NOT NULL;
ALTER TABLE "RecurringSlotDiscount" ALTER COLUMN "centerId" SET NOT NULL;
ALTER TABLE "CashPaymentUser"       ALTER COLUMN "centerId" SET NOT NULL;
ALTER TABLE "Wallet"                ALTER COLUMN "centerId" SET NOT NULL;

-- ───── 6. Foreign keys for centerId ─────────────────────────────────

ALTER TABLE "Slot"
  ADD CONSTRAINT "Slot_centerId_fkey"
  FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_centerId_fkey"
  FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Package"
  ADD CONSTRAINT "Package_centerId_fkey"
  FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BlockedSlot"
  ADD CONSTRAINT "BlockedSlot_centerId_fkey"
  FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OperatorAssignment"
  ADD CONSTRAINT "OperatorAssignment_centerId_fkey"
  FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_centerId_fkey"
  FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PromotionalOffer"
  ADD CONSTRAINT "PromotionalOffer_centerId_fkey"
  FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RecurringSlotDiscount"
  ADD CONSTRAINT "RecurringSlotDiscount_centerId_fkey"
  FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CashPaymentUser"
  ADD CONSTRAINT "CashPaymentUser_centerId_fkey"
  FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Wallet"
  ADD CONSTRAINT "Wallet_centerId_fkey"
  FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ───── 7. Swap unique constraints to be center-scoped ───────────────

-- Slot: (date, startTime) → (centerId, date, startTime)
ALTER TABLE "Slot" DROP CONSTRAINT IF EXISTS "Slot_date_startTime_key";
DROP INDEX IF EXISTS "Slot_date_startTime_key";
CREATE UNIQUE INDEX "Slot_centerId_date_startTime_key"
  ON "Slot"("centerId", "date", "startTime");
CREATE INDEX "Slot_centerId_date_idx" ON "Slot"("centerId", "date");

-- Booking: (date, startTime, machineId, pitchType)
--       → (centerId, date, startTime, machineId, pitchType)
ALTER TABLE "Booking" DROP CONSTRAINT IF EXISTS "Booking_date_startTime_machineId_pitchType_key";
DROP INDEX IF EXISTS "Booking_date_startTime_machineId_pitchType_key";
CREATE UNIQUE INDEX "Booking_centerId_date_startTime_machineId_pitchType_key"
  ON "Booking"("centerId", "date", "startTime", "machineId", "pitchType");

-- Booking indexes — add centerId-prefixed variants. Old indexes can stay
-- (they remain useful for status-only and userId scans) but we drop the
-- date-only variant in favour of the center-scoped one.
DROP INDEX IF EXISTS "Booking_date_status_idx";
CREATE INDEX "Booking_centerId_date_status_idx"
  ON "Booking"("centerId", "date", "status");
CREATE INDEX "Booking_centerId_status_idx"
  ON "Booking"("centerId", "status");

-- OperatorAssignment: (userId, machineId) → (centerId, userId, machineId)
ALTER TABLE "OperatorAssignment" DROP CONSTRAINT IF EXISTS "OperatorAssignment_userId_machineId_key";
DROP INDEX IF EXISTS "OperatorAssignment_userId_machineId_key";
CREATE UNIQUE INDEX "OperatorAssignment_centerId_userId_machineId_key"
  ON "OperatorAssignment"("centerId", "userId", "machineId");
CREATE INDEX "OperatorAssignment_centerId_idx" ON "OperatorAssignment"("centerId");

-- CashPaymentUser: userId @unique → (centerId, userId) @unique
ALTER TABLE "CashPaymentUser" DROP CONSTRAINT IF EXISTS "CashPaymentUser_userId_key";
DROP INDEX IF EXISTS "CashPaymentUser_userId_key";
CREATE UNIQUE INDEX "CashPaymentUser_centerId_userId_key"
  ON "CashPaymentUser"("centerId", "userId");
CREATE INDEX "CashPaymentUser_centerId_idx" ON "CashPaymentUser"("centerId");

-- Wallet: userId @unique → (userId, centerId) @unique. With one wallet
-- per user today, the existing row safely becomes the user's ABCA wallet.
ALTER TABLE "Wallet" DROP CONSTRAINT IF EXISTS "Wallet_userId_key";
DROP INDEX IF EXISTS "Wallet_userId_key";
CREATE UNIQUE INDEX "Wallet_userId_centerId_key"
  ON "Wallet"("userId", "centerId");
CREATE INDEX "Wallet_centerId_idx" ON "Wallet"("centerId");

-- ───── 8. Other new center-scoped indexes ────────────────────────────

CREATE INDEX "Package_centerId_isActive_idx"             ON "Package"("centerId", "isActive");
CREATE INDEX "BlockedSlot_centerId_startDate_endDate_idx" ON "BlockedSlot"("centerId", "startDate", "endDate");
CREATE INDEX "Payment_centerId_status_idx"                ON "Payment"("centerId", "status");
CREATE INDEX "PromotionalOffer_centerId_startDate_endDate_idx"
  ON "PromotionalOffer"("centerId", "startDate", "endDate");
CREATE INDEX "PromotionalOffer_centerId_isActive_idx"
  ON "PromotionalOffer"("centerId", "isActive");
CREATE INDEX "RecurringSlotDiscount_centerId_enabled_idx"
  ON "RecurringSlotDiscount"("centerId", "enabled");
