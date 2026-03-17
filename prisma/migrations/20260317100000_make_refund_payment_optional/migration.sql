-- AlterTable: make paymentId optional on Refund (allows wallet refunds for non-online bookings)
ALTER TABLE "Refund" ALTER COLUMN "paymentId" DROP NOT NULL;
