-- Add an optional public image URL to MachineType. When set, every
-- Machine instance of that type renders this image in the user-facing
-- picker — so any Yantra at any center automatically shows the Yantra
-- photo without per-instance configuration.

ALTER TABLE "MachineType"
  ADD COLUMN "imageUrl" TEXT;

-- Backfill the seeded types with the existing public asset paths so the
-- defaults come up correct on first deploy. Idempotent — only sets when
-- the row exists and currently has no image.
UPDATE "MachineType"
   SET "imageUrl" = '/images/yantra-machine.jpeg'
 WHERE "code" = 'YANTRA' AND "imageUrl" IS NULL;

UPDATE "MachineType"
   SET "imageUrl" = '/images/leathermachine.jpeg'
 WHERE "code" = 'GRAVITY' AND "imageUrl" IS NULL;

UPDATE "MachineType"
   SET "imageUrl" = '/images/tennismachine.jpeg'
 WHERE "code" = 'LEVERAGE' AND "imageUrl" IS NULL;
