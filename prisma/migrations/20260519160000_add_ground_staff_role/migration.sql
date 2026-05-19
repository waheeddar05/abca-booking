-- Add GROUND_STAFF to the MembershipRole enum.
--
-- Center-side facility staff (default contact for Cricket Nets +
-- Full Indoor Court bookings). Append-only — no existing rows are
-- migrated, no constraints change.
ALTER TYPE "MembershipRole" ADD VALUE 'GROUND_STAFF';
