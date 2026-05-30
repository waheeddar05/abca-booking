-- Per-machine pitch + ball compatibility.
--
-- Replaces the legacy global `MACHINE_PITCH_CONFIG` policy (keyed by the
-- `MachineId` enum) for any new center. ABCA's four seeded machines are
-- backfilled from the policy below so the existing user-facing flow keeps
-- working unchanged.
--
-- Defaults:
--   supportedPitchTypes = []  → no pitch chip shown
--   supportedBallTypes  = []  → falls back to the machineType.ballType
-- This means newly-created machines at any center are inert until the
-- admin configures them. Toplay's already-created machines will need the
-- admin to fill these in via the per-center Machines tab.

ALTER TABLE "Machine"
  ADD COLUMN "supportedPitchTypes" "PitchType"[] NOT NULL DEFAULT ARRAY[]::"PitchType"[],
  ADD COLUMN "supportedBallTypes"  "BallType"[]  NOT NULL DEFAULT ARRAY[]::"BallType"[];

-- Backfill ABCA's four seeded machines from the legacy global policy.
-- These IDs are stable seeds (see scripts/seed-centers.ts) so it's safe
-- to reference them directly.
UPDATE "Machine"
   SET "supportedPitchTypes" = ARRAY['ASTRO']::"PitchType"[],
       "supportedBallTypes"  = ARRAY['LEATHER']::"BallType"[]
 WHERE "id" = 'mch_abca_gravity';

UPDATE "Machine"
   SET "supportedPitchTypes" = ARRAY['ASTRO']::"PitchType"[],
       "supportedBallTypes"  = ARRAY['LEATHER', 'MACHINE']::"BallType"[]
 WHERE "id" = 'mch_abca_yantra';

UPDATE "Machine"
   SET "supportedPitchTypes" = ARRAY['ASTRO', 'CEMENT']::"PitchType"[],
       "supportedBallTypes"  = ARRAY['TENNIS']::"BallType"[]
 WHERE "id" = 'mch_abca_leverage_indoor';

UPDATE "Machine"
   SET "supportedPitchTypes" = ARRAY['ASTRO', 'CEMENT']::"PitchType"[],
       "supportedBallTypes"  = ARRAY['TENNIS']::"BallType"[]
 WHERE "id" = 'mch_abca_leverage_outdoor';
