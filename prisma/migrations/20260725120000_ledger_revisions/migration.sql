-- Ledger revisions: revenue categories, payment methods, session range.
--
-- Written as a separate migration rather than edits to
-- 20260725000000_add_ledger_entries because that one may already have
-- been applied — editing an applied migration breaks its checksum and
-- fails `prisma migrate deploy`.
--
-- Postgres cannot drop a value from an enum in place, so both enums are
-- recreated via rename → create → cast → drop.

-- ─── 1. Revenue categories: split the MATCH_PRACTICE umbrella ────────
--
-- MATCH_PRACTICE is a UI-level umbrella tab, not a `BookingCategory`
-- value, so it had no counterpart bucket on the dashboard's Revenue by
-- Category chart. Now that manual revenue is distributed into the same
-- buckets as system revenue, every ledger category must map onto a real
-- BookingCategory (plus OTHER for miscellaneous income).
--
-- Any existing MATCH_PRACTICE row is mapped to MATCH_SIMULATION: the
-- umbrella covered both subcategories, so neither target is strictly
-- "correct" — in practice there are no such rows, since the umbrella
-- only existed between these two migrations.

ALTER TYPE "LedgerRevenueCategory" RENAME TO "LedgerRevenueCategory_old";

CREATE TYPE "LedgerRevenueCategory" AS ENUM (
  'MACHINE',
  'NET',
  'SIDEARM',
  'COACHING',
  'FULL_COURT',
  'CORPORATE_BATCH',
  'MATCH_SIMULATION',
  'OTHER'
);

ALTER TABLE "LedgerEntry"
  ALTER COLUMN "revenueCategory" TYPE "LedgerRevenueCategory"
  USING (
    CASE
      WHEN "revenueCategory"::text = 'MATCH_PRACTICE' THEN 'MATCH_SIMULATION'
      ELSE "revenueCategory"::text
    END
  )::"LedgerRevenueCategory";

DROP TYPE "LedgerRevenueCategory_old";

-- ─── 2. Payment method shrinks to CASH / OTHER ───────────────────────
--
-- The old list mixed two different questions — HOW the money moved
-- (cash, UPI, card) and WHO handled it (the scanner accounts). "Who"
-- now has its own column pointing at a real User (section 4), so the
-- method itself reduces to cash vs. anything else. Every non-cash value
-- collapses into OTHER, which is exactly what it now means.

ALTER TYPE "LedgerPaymentMethod" RENAME TO "LedgerPaymentMethod_old";

CREATE TYPE "LedgerPaymentMethod" AS ENUM ('CASH', 'OTHER');

ALTER TABLE "LedgerEntry"
  ALTER COLUMN "paymentMethod" TYPE "LedgerPaymentMethod"
  USING (
    CASE "paymentMethod"::text
      WHEN 'CASH' THEN 'CASH'
      ELSE 'OTHER'
    END
  )::"LedgerPaymentMethod";

DROP TYPE "LedgerPaymentMethod_old";

-- ─── 3. Session timing becomes a range, on both kinds ────────────────
--
-- `serviceTime` recorded only when a session started. Sessions have a
-- duration, so it becomes a From/To pair. The existing single value is
-- the start time, so the column is renamed rather than dropped — no
-- data is lost.
--
-- These columns are no longer revenue-only: the expense form records
-- them too (e.g. a staff payout tied to a specific session). Nothing
-- changes structurally for that — they were already nullable.

ALTER TABLE "LedgerEntry" RENAME COLUMN "serviceTime" TO "serviceStartTime";
ALTER TABLE "LedgerEntry" ADD COLUMN "serviceEndTime" TEXT;

-- ─── 4. "Collected By": who physically handled the money ─────────────
--
-- A real User at the center rather than an enum of staff names, so the
-- picker tracks the actual roster instead of going stale whenever
-- someone joins or leaves. Distinct from `recordedById`, which is who
-- keyed the entry in — usually but not always the same person.
--
-- Nullable: existing rows predate the field, and an entry for money
-- that nobody personally handled (a bank credit) legitimately has none.
-- ON DELETE SET NULL so removing a user never destroys a ledger row.

ALTER TABLE "LedgerEntry" ADD COLUMN "collectedById" TEXT;

CREATE INDEX "LedgerEntry_centerId_collectedById_idx"
  ON "LedgerEntry"("centerId", "collectedById");

ALTER TABLE "LedgerEntry"
  ADD CONSTRAINT "LedgerEntry_collectedById_fkey"
  FOREIGN KEY ("collectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
