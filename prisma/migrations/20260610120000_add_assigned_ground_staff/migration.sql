-- Per-booking ground-staff assignment.
--
-- Facility bookings (Cricket Nets / Full Indoor Court / Corporate Batch)
-- now record WHICH ground-staff member handles them — the per-booking
-- analogue of operatorId for machine sessions. Nullable: MACHINE/SIDEARM/
-- COACHING use their own assigned person, and legacy rows stay null (the
-- UI falls back to the center's default ground staff when null).
ALTER TABLE "Booking" ADD COLUMN "assignedGroundStaffId" TEXT;

ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_assignedGroundStaffId_fkey"
  FOREIGN KEY ("assignedGroundStaffId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Booking_assignedGroundStaffId_idx"
  ON "Booking"("assignedGroundStaffId");
