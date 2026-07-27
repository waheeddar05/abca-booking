-- Ledger: "Online" joins Cash / Other as a way money can move.
-- Added at the end of the enum so existing stored values are untouched.
ALTER TYPE "LedgerPaymentMethod" ADD VALUE IF NOT EXISTS 'ONLINE';
