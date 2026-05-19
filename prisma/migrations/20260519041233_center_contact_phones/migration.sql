-- Multiple per-center contacts for the landing page 'Ready to play' strip.
-- Stored as JSON: [{ name: string | null, number: string }, ...]
-- Readers fall back to the existing contactPhone column when this is null.
ALTER TABLE "Center"
  ADD COLUMN "contactPhones" JSONB;

-- Backfill: any center with a contactPhone gets a single-entry array so
-- existing data renders the same as before until an admin edits it.
UPDATE "Center"
SET "contactPhones" = jsonb_build_array(jsonb_build_object('name', NULL, 'number', "contactPhone"))
WHERE "contactPhone" IS NOT NULL
  AND length(trim("contactPhone")) > 0
  AND "contactPhones" IS NULL;
