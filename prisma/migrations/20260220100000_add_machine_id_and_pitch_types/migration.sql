-- CreateEnum
CREATE TYPE "MachineId" AS ENUM ('GRAVITY', 'YANTRA', 'LEVERAGE_INDOOR', 'LEVERAGE_OUTDOOR');

-- AlterEnum: Add CEMENT and NATURAL to PitchType
ALTER TYPE "PitchType" ADD VALUE IF NOT EXISTS 'CEMENT';
ALTER TYPE "PitchType" ADD VALUE IF NOT EXISTS 'NATURAL';

-- AlterTable: Add machineId to Booking
ALTER TABLE "Booking" ADD COLUMN "machineId" "MachineId";

-- AlterTable: Add machineId to BlockedSlot
ALTER TABLE "BlockedSlot" ADD COLUMN "machineId" "MachineId";

-- Drop old unique constraint and create new one on Booking
-- The old constraint was: (date, startTime, ballType, pitchType)
-- The new constraint is: (date, startTime, machineId, pitchType)
DROP INDEX IF EXISTS "Booking_date_startTime_ballType_pitchType_key";
CREATE UNIQUE INDEX "Booking_date_startTime_machineId_pitchType_key" ON "Booking"("date", "startTime", "machineId", "pitchType");
