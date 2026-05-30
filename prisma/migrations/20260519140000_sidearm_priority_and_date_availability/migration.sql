-- Sidearm admin tab schema additions.
--
-- 1. CenterMembership.priority: tie-breaker when multiple memberships
--    are equally eligible at the same slot. Lower wins. Defaults to
--    100 so all existing rows are equivalent until an admin ranks them.
--
-- 2. MembershipDateAvailability: date-range / custom-window availability
--    for coaches and sidearm specialists. Additive on top of the
--    weekly MembershipAvailability rows. See schema.prisma for the
--    resolution rule.

ALTER TABLE "CenterMembership"
  ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 100;

CREATE TABLE "MembershipDateAvailability" (
  "id" TEXT NOT NULL,
  "membershipId" TEXT NOT NULL,
  "fromDate" DATE NOT NULL,
  "toDate" DATE NOT NULL,
  "startTime" TEXT,
  "endTime" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "label" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MembershipDateAvailability_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MembershipDateAvailability_membershipId_fromDate_toDate_idx"
  ON "MembershipDateAvailability" ("membershipId", "fromDate", "toDate");

ALTER TABLE "MembershipDateAvailability"
  ADD CONSTRAINT "MembershipDateAvailability_membershipId_fkey"
  FOREIGN KEY ("membershipId") REFERENCES "CenterMembership" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
