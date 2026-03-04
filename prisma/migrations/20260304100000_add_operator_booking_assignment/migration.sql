-- Add operatorId to Booking for auto-assignment
ALTER TABLE "Booking" ADD COLUMN "operatorId" TEXT;

-- Add operatorPriority to User for operator ordering
ALTER TABLE "User" ADD COLUMN "operatorPriority" INTEGER NOT NULL DEFAULT 0;

-- Foreign key: Booking.operatorId -> User.id
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Index for efficient operator booking lookups
CREATE INDEX "Booking_operatorId_idx" ON "Booking"("operatorId");
