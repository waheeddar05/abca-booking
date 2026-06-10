-- Link booking-related notifications to the booking they describe.
--
-- Lets the in-app Alerts view render the full Bookings-page card as a
-- snapshot (confirmation / cancellation / refund) instead of a plain
-- text summary. Nullable plain column (no FK constraint) so existing
-- rows stay valid and a hard-deleted booking just yields a null lookup.
ALTER TABLE "Notification" ADD COLUMN "bookingId" TEXT;

-- Supports the per-user, newest-first notifications listing.
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");
