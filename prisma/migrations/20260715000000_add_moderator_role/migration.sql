-- Add MODERATOR to the MembershipRole and UserRole enums.
--
-- MODERATOR is a restricted admin: it has access to most of the admin
-- panel but cannot reach Users / Settings / My Center, and cannot cancel
-- or refund bookings, reassign booking staff, or mutate packages. It is
-- append-only — no existing rows are migrated, no constraints change.
ALTER TYPE "MembershipRole" ADD VALUE IF NOT EXISTS 'MODERATOR';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'MODERATOR';
