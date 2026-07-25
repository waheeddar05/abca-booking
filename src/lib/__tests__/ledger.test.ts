import { describe, it, expect } from 'vitest';
import {
  LEDGER_EXPENSE_SUBCATEGORIES,
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
  paymentMethod: 'TOPLAY_SCANNER' as const,
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

  it('accepts an optional session date/time distinct from the payment date', () => {
    const parsed = LedgerEntryInputSchema.safeParse({
      ...baseRevenue,
      serviceDate: '2026-08-02',
      serviceTime: '07:00',
    });
    expect(parsed.success).toBe(true);
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
    expect(cols.serviceDate).toBeNull();
    expect(cols.serviceTime).toBeNull();
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

describe('labels', () => {
  it('labels both kinds off the right enum', () => {
    expect(ledgerCategoryLabel({ kind: 'REVENUE', revenueCategory: 'FULL_COURT' })).toBe(
      'Full Indoor Court',
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
