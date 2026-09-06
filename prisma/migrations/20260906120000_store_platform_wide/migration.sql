-- The Cricket Store is one catalog for all of PlayOrbit, not one per center.
--
-- The store was first cut center-scoped (MarketplaceProduct.centerId); the
-- product decision is that PlayOrbit sells one catalog to every customer
-- and hand-pick/collection happens at one configured location, so the
-- column, its foreign key and its indexes go. Nothing has been sold yet,
-- so there is no data to carry over.
--
-- Who runs the store is a platform-level grant modelled on isSuperAdmin:
-- User.isStoreAdmin. It is never a center membership.

-- DropForeignKey
ALTER TABLE "MarketplaceProduct" DROP CONSTRAINT IF EXISTS "MarketplaceProduct_centerId_fkey";

-- DropIndex
DROP INDEX IF EXISTS "MarketplaceProduct_centerId_isActive_category_idx";
DROP INDEX IF EXISTS "MarketplaceProduct_centerId_displayOrder_idx";

-- AlterTable
ALTER TABLE "MarketplaceProduct" DROP COLUMN IF EXISTS "centerId";

-- CreateIndex: /shop listing — published products, per category.
CREATE INDEX IF NOT EXISTS "MarketplaceProduct_isActive_category_idx" ON "MarketplaceProduct"("isActive", "category");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MarketplaceProduct_displayOrder_idx" ON "MarketplaceProduct"("displayOrder");

-- AlterTable: platform-level store admin flag.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isStoreAdmin" BOOLEAN NOT NULL DEFAULT false;
