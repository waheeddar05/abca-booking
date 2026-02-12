-- CreateEnum
CREATE TYPE "PitchType" AS ENUM ('ASTRO', 'TURF');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN "pitchType" "PitchType",
ADD COLUMN "extraCharge" DOUBLE PRECISION;
