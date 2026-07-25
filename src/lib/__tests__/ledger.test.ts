import { describe, it, expect } from 'vitest';
import {
  LEDGER_EXPENSE_SUBCATEGORIES,
  LEDGER_PAYMENT_METHODS,
  LEDGER_REVENUE_CATEGORIES,
  LEDGER_REVENUE_CATEGORY_LABELS,
  LedgerEntryInputSchema,
  categoryHasSubcategories,
  expenseSubcategoryLabel,
  ledgerCategoryLabel,
  toLedgerColumns,
} from '@/lib/ledger';

const baseRevenue = {
  kind: 'REVENUE' as const,
  revenueCategory: 'MACHINE' as const,
  customerName: 'Rahul',
  amount: 500,
  entryDate: '2026-07-25',
  entryTime: '18:30',
  paymentMethod: 'CASH' as const,
};

const baseExpense = {
  kind: 'EXPENSE' as const,
  expenseCategory: 'REPAIRS_MAINTENANCE' as const,
  expenseSubcategory: 'NET_REPAIR',
  description: 'Replaced torn side net',
  amount: 2500,
  entryDate: '2026-07-25',
  entryTime: '11:00',
  paymentMethod: 'OTHER' as const,
};

describe('LedgerEntryInputSchema — revenue', () => {
  it('accepts a minimal revenue entry', () => {
    const parsed = LedgerEntryInputSchema.safeParse(baseRevenue);
    expect(parsed.success).toBe(true);
  });

  it('requires a customer name', () => {
    const parsed = LedgerEntryInputSchema.safeParse({ ...baseRevenue, customerName: '  ' });
    expect(parsed.success).toBe(false);
  });

  it('rejects a zero or negative amount', () => {
    expect(LedgerEntryInputSchema.safeParse({ ...baseRevenue, amount: 0 }).success).toBe(false);
    expect(LedgerEntryInputSchema.safeParse({ ...baseRevenue, amount: -10 }).success).toBe(false);
  });

  it('rejects a malformed date or time', () => {
    expect(
      LedgerEntryInputSchema.safeParse({ ...baseRevenue, entryDate: '25-07-2026' }).success,
    ).toBe(false);
    expect(LedgerEntryInputSchema.safeParse({ ...baseRevenue, entryTime: '25:00' }).success).toBe(
      false,
    );
  });

  it('accepts an optional session date/range distinct from the payment date', () => {
    const parsed = LedgerEntryInputSchema.safeParse({
      ...baseRevenue,
      serviceDate: '2026-08-02',
      serviceStartTime: '07:00',
      serviceEndTime: '09:00',
    });
    expect(parsed.success).toBe(true);
  });
});

describe('session range', () => {
  it('rejects a To time at or before the From time', () => {
    for (const end of ['07:00', '06:30']) {
      const parsed = LedgerEntryInputSchema.safeParse({
        ...baseRevenue,
        serviceStartTime: '07:00',
        serviceEndTime: end,
      });
      expect(parsed.success, `end=${end} should be rejected`).toBe(false);
    }
  });

  it('applies the same range rule to expenses', () => {
    const parsed = LedgerEntryInputSchema.safeParse({
      ...baseExpense,
      serviceStartTime: '11:00',
      serviceEndTime: '10:00',
    });
    expect(parsed.success).toBe(false);
  });

  it('keeps the session range on an expense entry', () => {
    const parsed = LedgerEntryInputSchema.parse({
      ...baseExpense,
      serviceDate: '2026-07-25',
      serviceStartTime: '11:00',
      serviceEndTime: '12:30',
    });
    const cols = toLedgerColumns(parsed);
    expect(cols.serviceDate?.toISOString()).toBe('2026-07-25T00:00:00.000Z');
    expect(cols.serviceStartTime).toBe('11:00');
    expect(cols.serviceEndTime).toBe('12:30');
  });

  it('drops a To time with no From time — it describes nothing', () => {
    const parsed = LedgerEntryInputSchema.parse({
      ...baseRevenue,
      serviceEndTime: '09:00',
    });
    const cols = toLedgerColumns(parsed);
    expect(cols.serviceStartTime).toBeNull();
    expect(cols.serviceEndTime).toBeNull();
  });
});

describe('LedgerEntryInputSchema — expenses', () => {
  it('accepts a valid expense', () => {
    expect(LedgerEntryInputSchema.safeParse(baseExpense).success).toBe(true);
  });

  it('requires a description', () => {
    const parsed = LedgerEntryInputSchema.safeParse({ ...baseExpense, description: '' });
    expect(parsed.success).toBe(false);
  });

  it('requires a subcategory when the category has one', () => {
    const parsed = LedgerEntryInputSchema.safeParse({
      ...baseExpense,
      expenseSubcategory: undefined,
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a subcategory that belongs to a different category', () => {
    const parsed = LedgerEntryInputSchema.safeParse({
      ...baseExpense,
      expenseCategory: 'BALLS',
      expenseSubcategory: 'NET_REPAIR',
    });
    expect(parsed.success).toBe(false);
  });

  it('allows MISCELLANEOUS with no subcategory', () => {
    const parsed = LedgerEntryInputSchema.safeParse({
      ...baseExpense,
      expenseCategory: 'MISCELLANEOUS',
      expenseSubcategory: undefined,
    });
    expect(parsed.success).toBe(true);
  });
});

describe('toLedgerColumns', () => {
  it('nulls the expense columns on a revenue entry', () => {
    const parsed = LedgerEntryInputSchema.parse({ ...baseRevenue, serviceDate: '2026-08-02' });
    const cols = toLedgerColumns(parsed);
    expect(cols.revenueCategory).toBe('MACHINE');
    expect(cols.customerName).toBe('Rahul');
    expect(cols.serviceDate?.toISOString()).toBe('2026-08-02T00:00:00.000Z');
    expect(cols.expenseCategory).toBeNull();
    expect(cols.expenseSubcategory).toBeNull();
    expect(cols.description).toBeNull();
    expect(cols.paidTo).toBeNull();
  });

  it('nulls the revenue columns on an expense entry', () => {
    const parsed = LedgerEntryInputSchema.parse({ ...baseExpense, paidTo: 'Sharma Sports' });
    const cols = toLedgerColumns(parsed);
    expect(cols.expenseCategory).toBe('REPAIRS_MAINTENANCE');
    expect(cols.expenseSubcategory).toBe('NET_REPAIR');
    expect(cols.paidTo).toBe('Sharma Sports');
    expect(cols.revenueCategory).toBeNull();
    expect(cols.customerName).toBeNull();
  });

  it('drops a subcategory sent for MISCELLANEOUS', () => {
    const parsed = LedgerEntryInputSchema.parse({
      ...baseExpense,
      expenseCategory: 'MISCELLANEOUS',
      expenseSubcategory: 'NET_REPAIR',
    });
    const cols = toLedgerColumns(parsed);
    expect(cols.expenseSubcategory).toBeNull();
  });

  it('stores the entry date as UTC midnight, matching the @db.Date column', () => {
    const cols = toLedgerColumns(LedgerEntryInputSchema.parse(baseRevenue));
    expect(cols.entryDate.toISOString()).toBe('2026-07-25T00:00:00.000Z');
  });
});

describe('revenue categories mirror the booking categories', () => {
  // The dashboard merges manual revenue into the same Revenue-by-Category
  // buckets as system revenue, so every ledger revenue category (bar
  // OTHER) must be a real `BookingCategory`. If a booking category is
  // ever added, this catches the ledger falling out of step.
  const BOOKING_CATEGORIES_ON_CHART = [
    'MACHINE',
    'SIDEARM',
    'COACHING',
    'NET',
    'FULL_COURT',
    'CORPORATE_BATCH',
    'MATCH_SIMULATION',
  ];

  it('covers every charted booking category, plus OTHER', () => {
    expect([...LEDGER_REVENUE_CATEGORIES].sort()).toEqual(
      [...BOOKING_CATEGORIES_ON_CHART, 'OTHER'].sort(),
    );
  });

  it('has no MATCH_PRACTICE umbrella — it is not a BookingCategory', () => {
    expect(LEDGER_REVENUE_CATEGORIES).not.toContain('MATCH_PRACTICE');
  });

  it('labels every category', () => {
    for (const c of LEDGER_REVENUE_CATEGORIES) {
      expect(LEDGER_REVENUE_CATEGORY_LABELS[c], `missing label for ${c}`).toBeTruthy();
    }
  });
});

describe('collectedBy', () => {
  it('passes the collector through on both kinds', () => {
    const revenue = toLedgerColumns(
      LedgerEntryInputSchema.parse({ ...baseRevenue, collectedById: 'usr_raj' }),
    );
    expect(revenue.collectedById).toBe('usr_raj');

    const expense = toLedgerColumns(
      LedgerEntryInputSchema.parse({ ...baseExpense, collectedById: 'usr_raj' }),
    );
    expect(expense.collectedById).toBe('usr_raj');
  });

  it('normalises a missing or blank collector to null', () => {
    expect(toLedgerColumns(LedgerEntryInputSchema.parse(baseRevenue)).collectedById).toBeNull();
    expect(
      toLedgerColumns(LedgerEntryInputSchema.parse({ ...baseRevenue, collectedById: null }))
        .collectedById,
    ).toBeNull();
  });
});

describe('payment methods', () => {
  it('is just cash vs. everything else — who handled it is a separate field', () => {
    expect([...LEDGER_PAYMENT_METHODS]).toEqual(['CASH', 'OTHER']);
  });
});

describe('labels', () => {
  it('labels both kinds off the right enum', () => {
    expect(ledgerCategoryLabel({ kind: 'REVENUE', revenueCategory: 'FULL_COURT' })).toBe(
      'Full Indoor Court',
    );
    expect(ledgerCategoryLabel({ kind: 'REVENUE', revenueCategory: 'CORPORATE_BATCH' })).toBe(
      'Corporate Batch',
    );
    expect(ledgerCategoryLabel({ kind: 'REVENUE', revenueCategory: 'MATCH_SIMULATION' })).toBe(
      'Match Simulation',
    );
    expect(ledgerCategoryLabel({ kind: 'EXPENSE', expenseCategory: 'BALLS' })).toBe(
      'Ball Expenses',
    );
  });

  it('falls back to the raw code for an unknown subcategory', () => {
    expect(expenseSubcategoryLabel('BALLS', 'LEATHER_BALL')).toBe('Leather Ball');
    expect(expenseSubcategoryLabel('BALLS', 'SOMETHING_NEW')).toBe('SOMETHING_NEW');
    expect(expenseSubcategoryLabel('BALLS', null)).toBe('');
  });

  it('reports which categories have subcategories', () => {
    expect(categoryHasSubcategories('STAFF_PAYMENTS')).toBe(true);
    expect(categoryHasSubcategories('MISCELLANEOUS')).toBe(false);
  });

  it('gives every subcategory a unique code within its category', () => {
    for (const [category, options] of Object.entries(LEDGER_EXPENSE_SUBCATEGORIES)) {
      const codes = options.map((o) => o.value);
      expect(new Set(codes).size, `duplicate subcategory code in ${category}`).toBe(codes.length);
    }
  });
});
