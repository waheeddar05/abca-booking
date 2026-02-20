-- AlterTable: Add missing User columns
ALTER TABLE "User" ADD COLUMN "image" TEXT;
ALTER TABLE "User" ADD COLUMN "isBlacklisted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: Add missing Booking columns
ALTER TABLE "Booking" ADD COLUMN "createdBy" TEXT;
ALTER TABLE "Booking" ADD COLUMN "cancelledBy" TEXT;
ALTER TABLE "Booking" ADD COLUMN "cancellationReason" TEXT;
