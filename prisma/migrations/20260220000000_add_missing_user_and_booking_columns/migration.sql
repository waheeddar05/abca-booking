-- AlterTable: Add missing User columns
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "image" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isBlacklisted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: Add missing Booking columns
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "createdBy" TEXT;
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "cancelledBy" TEXT;
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "cancellationReason" TEXT;
