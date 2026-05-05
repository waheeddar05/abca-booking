-- Rename the SIDEARM_STAFF enum value to SIDEARM_SPECIALIST in both the
-- MembershipRole and UserRole types. Postgres 10+ supports an in-place
-- rename via ALTER TYPE ... RENAME VALUE — no data movement, all
-- existing rows automatically point at the new label.

ALTER TYPE "MembershipRole" RENAME VALUE 'SIDEARM_STAFF' TO 'SIDEARM_SPECIALIST';
ALTER TYPE "UserRole"        RENAME VALUE 'SIDEARM_STAFF' TO 'SIDEARM_SPECIALIST';
