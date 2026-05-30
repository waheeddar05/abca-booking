-- ──────────────────────────────────────────────────────────────────────
-- Resource-based booking model (phase 5)
--
-- Adds the BookingCategory enum, three optional FKs (assignedMachine,
-- assignedCoach, assignedStaff) and a BookingResourceAssignment table
-- that tracks which Resource(s) a booking consumes.
--
-- Existing ABCA bookings default to category=MACHINE and have no
-- resource assignments. Nothing about the legacy MACHINE_PITCH path
-- changes — the new fields are purely additive.
-- ──────────────────────────────────────────────────────────────────────

CREATE TYPE "BookingCategory" AS ENUM (
  'MACHINE',
  'SIDEARM',
  'COACHING',
  'FULL_COURT',
  'CORPORATE_BATCH'
);

ALTER TABLE "Booking"
  ADD COLUMN "category"          "BookingCategory" NOT NULL DEFAULT 'MACHINE',
  ADD COLUMN "assignedMachineId" TEXT,
  ADD COLUMN "assignedCoachId"   TEXT,
  ADD COLUMN "assignedStaffId"   TEXT;

ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_assignedMachineId_fkey"
  FOREIGN KEY ("assignedMachineId") REFERENCES "Machine"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_assignedCoachId_fkey"
  FOREIGN KEY ("assignedCoachId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_assignedStaffId_fkey"
  FOREIGN KEY ("assignedStaffId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Booking_centerId_category_date_idx"
  ON "Booking"("centerId", "category", "date");
CREATE INDEX "Booking_assignedMachineId_idx"
  ON "Booking"("assignedMachineId");
CREATE INDEX "Booking_assignedCoachId_idx"
  ON "Booking"("assignedCoachId");
CREATE INDEX "Booking_assignedStaffId_idx"
  ON "Booking"("assignedStaffId");

-- ───────── BookingResourceAssignment ─────────

CREATE TABLE "BookingResourceAssignment" (
  "id"         TEXT NOT NULL,
  "bookingId"  TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BookingResourceAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BookingResourceAssignment_bookingId_resourceId_key"
  ON "BookingResourceAssignment"("bookingId", "resourceId");
CREATE INDEX "BookingResourceAssignment_resourceId_idx"
  ON "BookingResourceAssignment"("resourceId");

ALTER TABLE "BookingResourceAssignment"
  ADD CONSTRAINT "BookingResourceAssignment_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "Booking"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BookingResourceAssignment"
  ADD CONSTRAINT "BookingResourceAssignment_resourceId_fkey"
  FOREIGN KEY ("resourceId") REFERENCES "Resource"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
