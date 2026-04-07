-- Convert PromotionalOffer machineId to machineIds array
ALTER TABLE "PromotionalOffer" ADD COLUMN "machineIds" "MachineId"[] NOT NULL DEFAULT ARRAY[]::"MachineId"[];

-- Migrate existing machineId values to machineIds
UPDATE "PromotionalOffer" SET "machineIds" = CASE WHEN "machineId" IS NOT NULL THEN ARRAY["machineId"]::"MachineId"[] ELSE ARRAY[]::"MachineId"[] END;

-- Drop old machineId column
ALTER TABLE "PromotionalOffer" DROP COLUMN "machineId";

-- Convert PromotionalOffer pitchType to pitchTypes array
ALTER TABLE "PromotionalOffer" ADD COLUMN "pitchTypes" "PitchType"[] NOT NULL DEFAULT ARRAY[]::"PitchType"[];

-- Migrate existing pitchType values to pitchTypes
UPDATE "PromotionalOffer" SET "pitchTypes" = CASE WHEN "pitchType" IS NOT NULL THEN ARRAY["pitchType"]::"PitchType"[] ELSE ARRAY[]::"PitchType"[] END;

-- Drop old pitchType column
ALTER TABLE "PromotionalOffer" DROP COLUMN "pitchType";

-- Convert RecurringSlotDiscount machineId to machineIds array
ALTER TABLE "RecurringSlotDiscount" ADD COLUMN "machineIds" "MachineId"[] NOT NULL DEFAULT ARRAY[]::"MachineId"[];

-- Migrate existing machineId values to machineIds
UPDATE "RecurringSlotDiscount" SET "machineIds" = CASE WHEN "machineId" IS NOT NULL THEN ARRAY["machineId"]::"MachineId"[] ELSE ARRAY[]::"MachineId"[] END;

-- Drop old machineId column
ALTER TABLE "RecurringSlotDiscount" DROP COLUMN "machineId";
