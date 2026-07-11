-- Admin money columns (CSV export, bookings list, dashboard revenue) resolve
-- each booking's collected amount from its Payment row via an array-overlap
-- filter ("bookingIds" && ARRAY[...]). Without a GIN index that filter
-- seq-scans Payment on every request.
CREATE INDEX IF NOT EXISTS "Payment_bookingIds_idx" ON "Payment" USING GIN ("bookingIds");

-- The wallet-ledger fallback filters DEBIT_BOOKING rows by referenceId
-- (booking id), which was previously unindexed.
CREATE INDEX IF NOT EXISTS "WalletTransaction_referenceId_idx" ON "WalletTransaction"("referenceId");
