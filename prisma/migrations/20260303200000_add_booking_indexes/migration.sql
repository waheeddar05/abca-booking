-- CreateIndex
CREATE INDEX IF NOT EXISTS "Booking_status_idx" ON "Booking"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Booking_userId_status_idx" ON "Booking"("userId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Booking_date_status_idx" ON "Booking"("date", "status");
