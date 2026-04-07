-- Add appliesTo field to PromotionalOffer
ALTER TABLE "PromotionalOffer" ADD COLUMN "appliesTo" TEXT NOT NULL DEFAULT 'ALL';

-- Add appliesTo field to RecurringSlotDiscount
ALTER TABLE "RecurringSlotDiscount" ADD COLUMN "appliesTo" TEXT NOT NULL DEFAULT 'ALL';
