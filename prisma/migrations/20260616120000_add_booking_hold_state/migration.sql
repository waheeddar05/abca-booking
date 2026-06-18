-- Reserve-then-confirm (saga) support.
-- Adds a pre-payment HOLD booking state plus the columns the hold lifecycle
-- needs. All additive + backward compatible: existing rows are unaffected and
-- centers without the RESERVE_BEFORE_PAYMENT policy never create HOLD rows.

-- AlterEnum: add the HOLD value to BookingStatus.
-- (Postgres 12+ allows ADD VALUE inside a transaction as long as the new
--  value is not referenced in the same transaction, which it isn't here.)
ALTER TYPE "BookingStatus" ADD VALUE 'HOLD';

-- AlterTable: hold lifecycle columns on Booking.
ALTER TABLE "Booking" ADD COLUMN "holdExpiresAt" TIMESTAMP(3),
ADD COLUMN "paymentId" TEXT;

-- CreateIndex: drives the lazy expiry sweep of stale HOLD rows.
CREATE INDEX "Booking_status_holdExpiresAt_idx" ON "Booking"("status", "holdExpiresAt");

-- CreateIndex: confirm/expiry look up holds by their originating online payment.
CREATE INDEX "Booking_paymentId_idx" ON "Booking"("paymentId");
