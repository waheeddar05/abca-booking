-- AlterTable: Add recurringDays and machineIds to BlockedSlot
ALTER TABLE "BlockedSlot" ADD COLUMN "recurringDays" INTEGER[] DEFAULT '{}';
ALTER TABLE "BlockedSlot" ADD COLUMN "machineIds" TEXT[] DEFAULT '{}';

-- AlterTable: Add kitRental and kitRentalCharge to Booking
ALTER TABLE "Booking" ADD COLUMN "kitRental" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Booking" ADD COLUMN "kitRentalCharge" DOUBLE PRECISION;
