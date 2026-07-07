-- Match Practice: Corporate Batch enrollments + Match Simulation sessions.
--
-- 1. New BookingCategory value for seat-based match-simulation sessions.
--    (Safe inside a transaction on PG 12+ as long as the new value isn't
--    used in this same migration — same pattern as 20260428080000.)
ALTER TYPE "BookingCategory" ADD VALUE IF NOT EXISTS 'MATCH_SIMULATION';

-- 2. How a corporate-batch seat was purchased.
CREATE TYPE "CorporateBatchMode" AS ENUM ('MONTHLY', 'HALF_MONTH', 'ADHOC');

-- 3. Enrollment discriminators on Booking. Null for every existing row —
--    no backfill needed (legacy CORPORATE_BATCH rows, if any, predate the
--    enrollment product and are treated as ad-hoc history).
ALTER TABLE "Booking"
  ADD COLUMN "corporateBatchMode" "CorporateBatchMode",
  ADD COLUMN "enrollmentPeriod" TEXT;

-- 4. Capacity counting per enrollment period (monthly / half-month).
CREATE INDEX "Booking_centerId_category_enrollmentPeriod_idx"
  ON "Booking"("centerId", "category", "enrollmentPeriod");
