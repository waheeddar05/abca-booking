-- Add morning/evening operator priority columns
ALTER TABLE "User" ADD COLUMN "operatorMorningPriority" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "operatorEveningPriority" INTEGER NOT NULL DEFAULT 0;

-- Create RecurringSlotDiscount table
CREATE TABLE "RecurringSlotDiscount" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "days" INTEGER[],
    "slotStartTime" TEXT NOT NULL,
    "slotEndTime" TEXT NOT NULL,
    "machineId" "MachineId",
    "oneSlotDiscount" DOUBLE PRECISION NOT NULL,
    "twoSlotDiscount" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringSlotDiscount_pkey" PRIMARY KEY ("id")
);
