-- CreateEnum: BookingPaymentMethod
CREATE TYPE "BookingPaymentMethod" AS ENUM ('ONLINE', 'CASH');

-- CreateEnum: BookingPaymentStatus
CREATE TYPE "BookingPaymentStatus" AS ENUM ('PENDING', 'PAID', 'UNPAID');

-- CreateEnum: NotificationChannel
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'WHATSAPP', 'BOTH');

-- CreateEnum: WhatsAppMessageStatus
CREATE TYPE "WhatsAppMessageStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateEnum: RefundMethod
CREATE TYPE "RefundMethod" AS ENUM ('RAZORPAY', 'WALLET');

-- CreateEnum: WalletTransactionType
CREATE TYPE "WalletTransactionType" AS ENUM ('CREDIT_REFUND', 'DEBIT_BOOKING', 'CREDIT_ADMIN', 'DEBIT_ADMIN');

-- AlterEnum: Add WHATSAPP to AuthProvider
ALTER TYPE "AuthProvider" ADD VALUE 'WHATSAPP';

-- AlterEnum: Add WALLET to BookingPaymentMethod
ALTER TYPE "BookingPaymentMethod" ADD VALUE 'WALLET';

-- AlterTable: Booking - add paymentMethod and paymentStatus
ALTER TABLE "Booking" ADD COLUMN "paymentMethod" "BookingPaymentMethod";
ALTER TABLE "Booking" ADD COLUMN "paymentStatus" "BookingPaymentStatus";

-- AlterTable: User - add mobileVerified
ALTER TABLE "User" ADD COLUMN "mobileVerified" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: Notification - add WhatsApp fields
ALTER TABLE "Notification" ADD COLUMN "channel" "NotificationChannel" NOT NULL DEFAULT 'IN_APP';
ALTER TABLE "Notification" ADD COLUMN "whatsappMessageId" TEXT;
ALTER TABLE "Notification" ADD COLUMN "whatsappStatus" "WhatsAppMessageStatus";

-- AlterTable: Payment - add refundMethod
ALTER TABLE "Payment" ADD COLUMN "refundMethod" "RefundMethod";

-- CreateTable: Wallet
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: Wallet unique userId
CREATE UNIQUE INDEX "Wallet_userId_key" ON "Wallet"("userId");

-- AddForeignKey: Wallet -> User
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: WalletTransaction
CREATE TABLE "WalletTransaction" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "type" "WalletTransactionType" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "balance" DOUBLE PRECISION NOT NULL,
    "description" TEXT,
    "referenceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: WalletTransaction walletId
CREATE INDEX "WalletTransaction_walletId_idx" ON "WalletTransaction"("walletId");

-- AddForeignKey: WalletTransaction -> Wallet
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
