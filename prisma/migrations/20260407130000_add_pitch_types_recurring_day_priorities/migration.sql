-- AlterTable: Add pitchTypes array to RecurringSlotDiscount
ALTER TABLE "RecurringSlotDiscount" ADD COLUMN "pitchTypes" "PitchType"[] DEFAULT ARRAY[]::"PitchType"[];

-- AlterTable: Add operatorDayPriorities JSON to User
ALTER TABLE "User" ADD COLUMN "operatorDayPriorities" JSONB;
