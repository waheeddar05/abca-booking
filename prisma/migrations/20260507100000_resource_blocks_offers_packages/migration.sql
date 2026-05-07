-- Resource-based parity for blocks, offers, recurring discounts, and
-- packages. Adds new targeting axes alongside the legacy ABCA columns
-- so existing rows behave unchanged. Empty new arrays = "no filter on
-- that axis" (legacy semantics).

-- ─── BlockedSlot ─────────────────────────────────────────────────────
ALTER TABLE "BlockedSlot"
  ADD COLUMN "machineRowIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "resourceIds"   TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "categories"    "BookingCategory"[] DEFAULT ARRAY[]::"BookingCategory"[];

-- ─── PromotionalOffer ────────────────────────────────────────────────
ALTER TABLE "PromotionalOffer"
  ADD COLUMN "machineRowIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "categories"    "BookingCategory"[] DEFAULT ARRAY[]::"BookingCategory"[];

-- ─── RecurringSlotDiscount ───────────────────────────────────────────
ALTER TABLE "RecurringSlotDiscount"
  ADD COLUMN "machineRowIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "categories"    "BookingCategory"[] DEFAULT ARRAY[]::"BookingCategory"[];

-- ─── Package ─────────────────────────────────────────────────────────
ALTER TABLE "Package"
  ADD COLUMN "category"     "BookingCategory",
  ADD COLUMN "machineRowId" TEXT;

ALTER TABLE "Package"
  ADD CONSTRAINT "Package_machineRowId_fkey"
  FOREIGN KEY ("machineRowId")
  REFERENCES "Machine"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

CREATE INDEX "Package_machineRowId_idx" ON "Package"("machineRowId");
