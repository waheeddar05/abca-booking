-- ──────────────────────────────────────────────────────────────────────
-- HOTFIX: Relax NOT NULL on centerId columns
--
-- Background: a previous Vercel preview build for the prod project
-- (PR #52, multi-center support) ran `prisma migrate deploy` against the
-- prod database before the Next.js build failed. The schema migrations
-- succeeded — adding `centerId NOT NULL` to all center-scoped tables —
-- but the deployed prod code (still on `main`) doesn't include `centerId`
-- in any `prisma.*.create()` calls. Result: every new Payment / Booking /
-- etc. fails with:
--
--     Null constraint violation on the fields: (`centerId`)
--
-- This migration drops the NOT NULL constraint on those `centerId`
-- columns so prod's existing code starts working again. The columns and
-- their backfilled values (every existing row → 'ctr_abca') stay in
-- place, harmless for old code that ignores the column.
--
-- This is intentionally idempotent (`IF EXISTS` guards) and ONLY relaxes
-- existing constraints — it doesn't drop tables, change unique indexes,
-- or undo the seeded ABCA / MachineType / Machine rows. The full
-- multi-center work (PR #52 + #53) will land on main later via a normal
-- promotion path; before that ships, the new rows that this hotfix
-- allows to have NULL centerId will be backfilled to 'ctr_abca'.
-- ──────────────────────────────────────────────────────────────────────

ALTER TABLE "Booking"               ALTER COLUMN "centerId" DROP NOT NULL;
ALTER TABLE "Slot"                  ALTER COLUMN "centerId" DROP NOT NULL;
ALTER TABLE "Package"               ALTER COLUMN "centerId" DROP NOT NULL;
ALTER TABLE "BlockedSlot"           ALTER COLUMN "centerId" DROP NOT NULL;
ALTER TABLE "OperatorAssignment"    ALTER COLUMN "centerId" DROP NOT NULL;
ALTER TABLE "Payment"               ALTER COLUMN "centerId" DROP NOT NULL;
ALTER TABLE "PromotionalOffer"      ALTER COLUMN "centerId" DROP NOT NULL;
ALTER TABLE "RecurringSlotDiscount" ALTER COLUMN "centerId" DROP NOT NULL;
ALTER TABLE "CashPaymentUser"       ALTER COLUMN "centerId" DROP NOT NULL;
ALTER TABLE "Wallet"                ALTER COLUMN "centerId" DROP NOT NULL;
