-- Add netCount to BlockedSlot for partial cricket-net blocking.
-- NULL = block all nets (preserves prior behaviour).
-- Positive integer = block that many nets out of the indoor pool;
-- remaining capacity is still bookable.
ALTER TABLE "BlockedSlot" ADD COLUMN "netCount" INTEGER;
