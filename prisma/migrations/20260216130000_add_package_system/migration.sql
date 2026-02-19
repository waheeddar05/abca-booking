-- CreateEnum
DO $$ BEGIN CREATE TYPE "MachineType" AS ENUM ('LEATHER', 'TENNIS'); EXCEPTION WHEN duplicate_object THEN null; END $$;
-- CreateEnum
DO $$ BEGIN CREATE TYPE "PackageBallType" AS ENUM ('MACHINE', 'LEATHER', 'BOTH'); EXCEPTION WHEN duplicate_object THEN null; END $$;
-- CreateEnum
DO $$ BEGIN CREATE TYPE "PackageWicketType" AS ENUM ('CEMENT', 'ASTRO', 'BOTH'); EXCEPTION WHEN duplicate_object THEN null; END $$;
-- CreateEnum
DO $$ BEGIN CREATE TYPE "TimingType" AS ENUM ('DAY', 'EVENING', 'BOTH'); EXCEPTION WHEN duplicate_object THEN null; END $$;
-- CreateEnum
DO $$ BEGIN CREATE TYPE "UserPackageStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CANCELLED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
-- CreateTable
CREATE TABLE "Package" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "machineType" "MachineType" NOT NULL,
    "ballType" "PackageBallType",
    "wicketType" "PackageWicketType",
    "timingType" "TimingType" NOT NULL,
    "totalSessions" INTEGER NOT NULL,
    "validityDays" INTEGER NOT NULL DEFAULT 30,
    "price" DOUBLE PRECISION NOT NULL,
    "extraChargeRules" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Package_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "UserPackage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "totalSessions" INTEGER NOT NULL,
    "usedSessions" INTEGER NOT NULL DEFAULT 0,
    "activationDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiryDate" TIMESTAMP(3) NOT NULL,
    "status" "UserPackageStatus" NOT NULL DEFAULT 'ACTIVE',
    "amountPaid" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UserPackage_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "PackageBooking" (
    "id" TEXT NOT NULL,
    "userPackageId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "sessionsUsed" INTEGER NOT NULL DEFAULT 1,
    "extraCharge" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "extraChargeType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PackageBooking_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "PackageBooking_bookingId_key" ON "PackageBooking"("bookingId");
-- AddForeignKey
ALTER TABLE "UserPackage" ADD CONSTRAINT "UserPackage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "UserPackage" ADD CONSTRAINT "UserPackage_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "PackageBooking" ADD CONSTRAINT "PackageBooking_userPackageId_fkey" FOREIGN KEY ("userPackageId") REFERENCES "UserPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "PackageBooking" ADD CONSTRAINT "PackageBooking_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- CreateTable
CREATE TABLE "PackageAuditLog" (
    "id" TEXT NOT NULL,
    "userPackageId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" JSONB,
    "performedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PackageAuditLog_pkey" PRIMARY KEY ("id")
);
-- AddForeignKey
ALTER TABLE "PackageAuditLog" ADD CONSTRAINT "PackageAuditLog_userPackageId_fkey" FOREIGN KEY ("userPackageId") REFERENCES "UserPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
