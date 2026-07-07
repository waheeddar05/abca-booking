-- Product rename: the per-session Corporate Batch purchase mode is called
-- "Regular" (Monthly / Regular), not "Ad-hoc". Rename the enum value
-- in-place — existing rows keep their data and read back as REGULAR.
-- (Same pattern as the SIDEARM_STAFF → SIDEARM_SPECIALIST rename.)
ALTER TYPE "CorporateBatchMode" RENAME VALUE 'ADHOC' TO 'REGULAR';
