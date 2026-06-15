-- Effective Date Range for weekly availability.
--
-- Adds an inclusive [effectiveFrom, effectiveTo] window to each weekly
-- MembershipAvailability row. The weekly schedule only applies to dates
-- inside this window (e.g. "every Mon/Wed/Fri 06:00–09:00 between
-- 01-Jan-2026 and 31-Dec-2026"). Both columns are nullable — NULL means
-- "no limit on that side", so existing rows keep applying indefinitely.
--
-- The standalone MembershipDateAvailability ("Date Range Availability")
-- feature is retired in favour of this. The table is intentionally left
-- in place so existing rows aren't dropped; the application no longer
-- reads or writes it.

ALTER TABLE "MembershipAvailability"
  ADD COLUMN "effectiveFrom" DATE,
  ADD COLUMN "effectiveTo" DATE;
