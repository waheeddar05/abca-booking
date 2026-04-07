-- AlterTable: Add Special User fields to User
ALTER TABLE "User" ADD COLUMN "isSpecialUser" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "specialDiscountType" "DiscountType";
ALTER TABLE "User" ADD COLUMN "specialDiscountValue" DOUBLE PRECISION;

-- AlterTable: Add weekday support to OperatorAssignment
ALTER TABLE "OperatorAssignment" ADD COLUMN "days" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- CreateTable: PromotionalOffer
CREATE TABLE "PromotionalOffer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "timeSlotStart" TEXT,
    "timeSlotEnd" TEXT,
    "days" INTEGER[],
    "machineId" "MachineId",
    "pitchType" "PitchType",
    "discountType" "DiscountType" NOT NULL,
    "discountValue" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromotionalOffer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PromotionalOffer_startDate_endDate_idx" ON "PromotionalOffer"("startDate", "endDate");
CREATE INDEX "PromotionalOffer_isActive_idx" ON "PromotionalOffer"("isActive");
