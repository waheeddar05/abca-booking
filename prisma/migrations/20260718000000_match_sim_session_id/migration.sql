-- Match Simulation: per-session monthly memberships.
--
-- Match-simulation sessions gain a Monthly / Regular booking option
-- (mirroring Corporate Batch). A monthly membership is tied to ONE
-- configured session, so we record which session a seat belongs to.
-- This lets monthly members be counted per session independently even
-- when two sessions share the same start time.
--
-- Nullable plain column (no FK — the session id lives in the
-- MATCH_SIMULATION_CONFIG center policy, not a table). Null for every
-- existing row: legacy match-simulation seats keep being counted by
-- (date, startTime), and non-match-practice rows never set it.
ALTER TABLE "Booking" ADD COLUMN "matchSimSessionId" TEXT;

-- Per-session monthly membership capacity counting
-- (category = MATCH_SIMULATION, corporateBatchMode = MONTHLY,
--  matchSimSessionId = <session>, enrollmentPeriod = "YYYY-MM").
CREATE INDEX "Booking_centerId_category_matchSimSessionId_enrollmentPeri_idx"
  ON "Booking"("centerId", "category", "matchSimSessionId", "enrollmentPeriod");
