-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENTAGE', 'FIXED');

-- CreateTable
CREATE TABLE "Slot" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "price" DOUBLE PRECISION NOT NULL DEFAULT 600,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Slot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Slot_date_startTime_key" ON "Slot"("date", "startTime");

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN "price" DOUBLE PRECISION;
ALTER TABLE "Booking" ADD COLUMN "originalPrice" DOUBLE PRECISION;
ALTER TABLE "Booking" ADD COLUMN "discountAmount" DOUBLE PRECISION;
ALTER TABLE "Booking" ADD COLUMN "discountType" "DiscountType";
