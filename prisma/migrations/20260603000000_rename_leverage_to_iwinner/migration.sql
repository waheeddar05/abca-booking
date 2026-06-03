-- Rebrand the tennis "Leverage" machine as "iWinner" in stored display names.
--
-- Identifiers are intentionally left unchanged: the MachineId enum values
-- (LEVERAGE_INDOOR / LEVERAGE_OUTDOOR) and the MachineType.code ('LEVERAGE')
-- are stable keys. Only the human-readable `name` columns are updated, and
-- each UPDATE is guarded on the old value so it is idempotent and never
-- clobbers a name an admin has since customised.

-- Global machine-type catalog name (shown in the centers admin + add-machine picker).
UPDATE "MachineType"
SET "name" = 'iWinner'
WHERE "code" = 'LEVERAGE' AND "name" = 'Leverage Tennis';

-- ABCA's two tennis machine instances (center-scoped).
UPDATE "Machine"
SET "name" = 'iWinner (Indoor)'
WHERE "centerId" = 'ctr_abca' AND "legacyMachineId" = 'LEVERAGE_INDOOR' AND "name" = 'Leverage Indoor';

UPDATE "Machine"
SET "name" = 'iWinner (Outdoor)'
WHERE "centerId" = 'ctr_abca' AND "legacyMachineId" = 'LEVERAGE_OUTDOOR' AND "name" = 'Leverage Outdoor';
