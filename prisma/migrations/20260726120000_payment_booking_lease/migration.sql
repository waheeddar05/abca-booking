-- Booking lease on Payment: serialises booking creation for a single
-- payment across verify / webhook / reconciler so a captured payment can
-- never be fulfilled twice.
ALTER TABLE "Payment" ADD COLUMN     "bookingClaimAt" TIMESTAMP(3),
ADD COLUMN     "bookingClaimBy" TEXT;
