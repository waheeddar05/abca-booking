-- Weekly recurring availability windows per CenterMembership.
--
-- Empty (no rows for a given membership) is the legacy default —
-- user is treated as available for every slot. Add rows to *restrict*.
-- Multiple rows on the same day stack as a union of time windows.

CREATE TABLE "MembershipAvailability" (
  "id"           TEXT NOT NULL,
  "membershipId" TEXT NOT NULL,
  "dayOfWeek"    INTEGER NOT NULL,
  "startTime"    TEXT NOT NULL,
  "endTime"      TEXT NOT NULL,
  "isActive"     BOOLEAN NOT NULL DEFAULT true,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MembershipAvailability_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MembershipAvailability_membershipId_dayOfWeek_idx"
  ON "MembershipAvailability"("membershipId", "dayOfWeek");

ALTER TABLE "MembershipAvailability"
  ADD CONSTRAINT "MembershipAvailability_membershipId_fkey"
  FOREIGN KEY ("membershipId") REFERENCES "CenterMembership"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
