-- Ledger: manually recorded revenue & expenses.
--
-- One table for both sides of the book, discriminated by `kind`:
--   REVENUE — money in  (walk-in cash, off-platform payments, …)
--   EXPENSE — money out (repairs, balls, staff payouts, utilities, …)
-- Kind-specific columns are nullable here and enforced per-kind in the
-- application layer (src/lib/ledger.ts).
--
-- Purely additive: no existing table or row is touched.

CREATE TYPE "LedgerEntryKind" AS ENUM ('REVENUE', 'EXPENSE');

CREATE TYPE "LedgerRevenueCategory" AS ENUM (
  'MACHINE',
  'NET',
  'SIDEARM',
  'COACHING',
  'FULL_COURT',
  'MATCH_PRACTICE',
  'OTHER'
);

CREATE TYPE "LedgerExpenseCategory" AS ENUM (
  'REPAIRS_MAINTENANCE',
  'BALLS',
  'STAFF_PAYMENTS',
  'UTILITIES_CONSUMABLES',
  'MISCELLANEOUS'
);

CREATE TYPE "LedgerPaymentMethod" AS ENUM (
  'CASH',
  'TOPLAY_SCANNER',
  'PLAYORBIT_SCANNER',
  'UPI',
  'CARD',
  'BANK_TRANSFER',
  'ONLINE',
  'OTHER'
);

CREATE TABLE "LedgerEntry" (
  "id"                 TEXT NOT NULL,
  "centerId"           TEXT NOT NULL,
  "kind"               "LedgerEntryKind" NOT NULL,

  -- REVENUE-only
  "revenueCategory"    "LedgerRevenueCategory",
  "customerName"       TEXT,
  -- Date/time the session being paid for takes place; distinct from
  -- entryDate/entryTime (when the money changed hands).
  "serviceDate"        DATE,
  "serviceTime"        TEXT,

  -- EXPENSE-only
  "expenseCategory"    "LedgerExpenseCategory",
  -- Subcategory code from the catalog in lib/ledger.ts. Text, not an
  -- enum, so the catalog can grow without a migration.
  "expenseSubcategory" TEXT,
  "description"        TEXT,
  "paidTo"             TEXT,

  -- Shared
  "amount"             DOUBLE PRECISION NOT NULL,
  "entryDate"          DATE NOT NULL,
  "entryTime"          TEXT NOT NULL,
  "paymentMethod"      "LedgerPaymentMethod" NOT NULL,
  "remarks"            TEXT,
  "recordedById"       TEXT NOT NULL,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL,

  CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- Dashboard/report scans: "all entries of kind K at center C in range".
CREATE INDEX "LedgerEntry_centerId_kind_entryDate_idx"
  ON "LedgerEntry"("centerId", "kind", "entryDate");

-- "Recorded By" filter.
CREATE INDEX "LedgerEntry_centerId_recordedById_idx"
  ON "LedgerEntry"("centerId", "recordedById");

ALTER TABLE "LedgerEntry"
  ADD CONSTRAINT "LedgerEntry_centerId_fkey"
  FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LedgerEntry"
  ADD CONSTRAINT "LedgerEntry_recordedById_fkey"
  FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
