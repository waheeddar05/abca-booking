-- Allow OperatorAssignment to point at a Machine row (RESOURCE_BASED
-- centers like Toplay) in addition to the legacy MachineId enum
-- (ABCA-style centers). Exactly one of (machineId, machineRowId) is
-- set per row, enforced by partial unique indexes below.

-- 1. Drop the old strict unique that assumed machineId was always set.
ALTER TABLE "OperatorAssignment"
  DROP CONSTRAINT IF EXISTS "OperatorAssignment_centerId_userId_machineId_key";

-- 2. Make the legacy enum nullable so RESOURCE_BASED rows can omit it.
ALTER TABLE "OperatorAssignment"
  ALTER COLUMN "machineId" DROP NOT NULL;

-- 3. Add the new FK column. ON DELETE CASCADE so removing a Machine
--    row also tears down its assignments — same semantics as the
--    existing center/user FKs.
ALTER TABLE "OperatorAssignment"
  ADD COLUMN "machineRowId" TEXT;

ALTER TABLE "OperatorAssignment"
  ADD CONSTRAINT "OperatorAssignment_machineRowId_fkey"
  FOREIGN KEY ("machineRowId")
  REFERENCES "Machine"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

CREATE INDEX "OperatorAssignment_machineRowId_idx"
  ON "OperatorAssignment"("machineRowId");

-- 4. Partial unique indexes — one per axis. With NULLs, Postgres treats
--    each NULL as distinct in a normal unique index, so the legacy
--    full-row unique would have allowed dupes. Partial indexes scope
--    each unique to "rows that actually use this axis".
CREATE UNIQUE INDEX "OperatorAssignment_centerId_userId_machineId_uniq"
  ON "OperatorAssignment"("centerId", "userId", "machineId")
  WHERE "machineId" IS NOT NULL;

CREATE UNIQUE INDEX "OperatorAssignment_centerId_userId_machineRowId_uniq"
  ON "OperatorAssignment"("centerId", "userId", "machineRowId")
  WHERE "machineRowId" IS NOT NULL;

-- 5. Sanity: every existing row is ABCA-shaped (machineId set,
--    machineRowId null). No data migration needed.
