import { describe, it, expect } from 'vitest';
import {
  aggregateRevenue,
  rowRevenue,
  UNATTRIBUTED_MACHINE_LABEL,
  MANUAL_MACHINE_LABEL,
  type RevenueRow,
} from '../dashboard-revenue';

/** Convenience: build a row with only the fields a case cares about. */
function row(partial: Partial<RevenueRow> & { category: string }): RevenueRow {
  return { online: 0, wallet: 0, refunds: 0, ...partial };
}

const sum = (buckets: Array<{ amount: number }>) =>
  Math.round(buckets.reduce((t, b) => t + b.amount, 0) * 100) / 100;

const bucket = (buckets: Array<{ key: string; amount: number }>, key: string) =>
  buckets.find(b => b.key === key)?.amount ?? 0;

describe('rowRevenue', () => {
  it('is online + wallet − refunds', () => {
    expect(rowRevenue(row({ category: 'MACHINE', online: 500, wallet: 200, refunds: 100 }))).toBe(600);
  });

  it('counts a wallet-only payment', () => {
    expect(rowRevenue(row({ category: 'SIDEARM', wallet: 300 }))).toBe(300);
  });

  it('is zero for a booking that collected nothing (cash / free / package-covered)', () => {
    expect(rowRevenue(row({ category: 'MACHINE' }))).toBe(0);
  });

  it('goes negative when a refund exceeds this row\'s share of its order', () => {
    // Deliberate: the excess has to be able to travel to the row's siblings,
    // which is what keeps a multi-slot order's total honest.
    expect(rowRevenue(row({ category: 'MACHINE', online: 100, refunds: 150 }))).toBe(-50);
  });
});

describe('aggregateRevenue — Σ(category bars) === Total Revenue', () => {
  it('holds across bookings, packages, manual revenue and refunds', () => {
    const rows = [
      row({ category: 'MACHINE', online: 1000, wallet: 250, machineName: 'Yantra' }),
      row({ category: 'MACHINE', online: 400, refunds: 150, machineName: 'Gravity Advanced Plus' }),
      row({ category: 'SIDEARM', online: 600 }),
      row({ category: 'COACHING', wallet: 800, refunds: 200 }),
      row({ category: 'NET', online: 350 }),
      row({ category: 'FULL_COURT', online: 2000 }),
      row({ category: 'CORPORATE_BATCH', online: 2000 }),
      row({ category: 'MATCH_SIMULATION', online: 500, refunds: 500 }),
      row({ category: 'OTHER', online: 750 }),
    ];

    const result = aggregateRevenue(rows);

    // 1250 + 250 + 600 + 600 + 350 + 2000 + 2000 + 0 + 750
    expect(result.totalRevenue).toBe(7800);
    expect(sum(result.byCategory)).toBe(result.totalRevenue);
    // Cross-check against the raw formula, independent of the bucketing.
    expect(result.totalRevenue).toBe(sum(rows.map(r => ({ amount: rowRevenue(r) }))));
  });

  it('nets a fully refunded category out instead of showing a zero bar', () => {
    const result = aggregateRevenue([
      row({ category: 'MACHINE', online: 500, machineName: 'Yantra' }),
      row({ category: 'SIDEARM', online: 300, refunds: 300 }),
    ]);

    expect(result.byCategory.map(b => b.key)).toEqual(['MACHINE']);
    expect(result.totalRevenue).toBe(500);
    expect(sum(result.byCategory)).toBe(result.totalRevenue);
  });

  it('keeps the total honest when a cancelled slot was refunded more than its even share', () => {
    // A ₹300 order over three slots priced 150/100/50. Each slot's even
    // share of the payment is ₹100. The ₹150 slot is cancelled and refunded
    // in full, so the center kept ₹150.
    const result = aggregateRevenue([
      row({ category: 'MACHINE', online: 100, refunds: 150, machineName: 'Yantra' }),
      row({ category: 'MACHINE', online: 100, machineName: 'Yantra' }),
      row({ category: 'MACHINE', online: 100, machineName: 'Yantra' }),
    ]);

    expect(result.totalRevenue).toBe(150);
    expect(bucket(result.byMachine, 'Yantra')).toBe(150);
  });

  it('returns zeroes for an empty range rather than throwing', () => {
    const result = aggregateRevenue([]);
    expect(result).toEqual({ totalRevenue: 0, byCategory: [], byMachine: [] });
  });

  it('sorts the biggest earner first', () => {
    const result = aggregateRevenue([
      row({ category: 'NET', online: 100 }),
      row({ category: 'MACHINE', online: 900, machineName: 'Yantra' }),
      row({ category: 'SIDEARM', online: 400 }),
    ]);
    expect(result.byCategory.map(b => b.key)).toEqual(['MACHINE', 'SIDEARM', 'NET']);
  });
});

describe('aggregateRevenue — Σ(machine bars) === the MACHINE category bar', () => {
  it('holds for plain machine bookings', () => {
    const result = aggregateRevenue([
      row({ category: 'MACHINE', online: 1000, wallet: 200, refunds: 300, machineName: 'Yantra' }),
      row({ category: 'MACHINE', online: 700, machineName: 'Gravity Advanced Plus' }),
      row({ category: 'MACHINE', wallet: 450, machineName: 'iWinner (Indoor)' }),
      row({ category: 'SIDEARM', online: 5000 }),
    ]);

    expect(bucket(result.byCategory, 'MACHINE')).toBe(2050);
    expect(sum(result.byMachine)).toBe(bucket(result.byCategory, 'MACHINE'));
    expect(bucket(result.byMachine, 'Yantra')).toBe(900);
    expect(bucket(result.byMachine, 'Gravity Advanced Plus')).toBe(700);
    expect(bucket(result.byMachine, 'iWinner (Indoor)')).toBe(450);
  });

  it('holds when hand-entered Ledger revenue is filed under Bowling Machine', () => {
    // A manual entry names a category but never a machine. It must still
    // land somewhere on the machine chart, or the bars stop explaining the
    // category bar they sit under.
    const result = aggregateRevenue([
      row({ category: 'MACHINE', online: 1200, machineName: 'Yantra' }),
      row({ category: 'MACHINE', online: 800, machineName: MANUAL_MACHINE_LABEL }),
    ]);

    expect(bucket(result.byCategory, 'MACHINE')).toBe(2000);
    expect(sum(result.byMachine)).toBe(2000);
    expect(bucket(result.byMachine, MANUAL_MACHINE_LABEL)).toBe(800);
  });

  it('files a machine booking that names no machine under "Other"', () => {
    const result = aggregateRevenue([
      row({ category: 'MACHINE', online: 500, machineName: 'Yantra' }),
      row({ category: 'MACHINE', online: 300, machineName: null }),
      row({ category: 'MACHINE', online: 200, machineName: '   ' }),
    ]);

    expect(bucket(result.byMachine, UNATTRIBUTED_MACHINE_LABEL)).toBe(500);
    expect(sum(result.byMachine)).toBe(bucket(result.byCategory, 'MACHINE'));
  });

  it('never puts non-machine revenue on the machine chart', () => {
    const result = aggregateRevenue([
      row({ category: 'SIDEARM', online: 600, machineName: 'Yantra' }),
      row({ category: 'OTHER', online: 400, machineName: MANUAL_MACHINE_LABEL }),
    ]);

    expect(result.byMachine).toEqual([]);
    expect(bucket(result.byCategory, 'MACHINE')).toBe(0);
  });

  it('holds when a machine nets to zero and drops off the chart', () => {
    const result = aggregateRevenue([
      row({ category: 'MACHINE', online: 700, machineName: 'Yantra' }),
      row({ category: 'MACHINE', online: 300, refunds: 300, machineName: 'Gravity Advanced Plus' }),
    ]);

    expect(result.byMachine.map(b => b.key)).toEqual(['Yantra']);
    expect(sum(result.byMachine)).toBe(bucket(result.byCategory, 'MACHINE'));
  });
});

describe('aggregateRevenue — categorisation', () => {
  it('treats a blank category as MACHINE (legacy ABCA packages)', () => {
    const result = aggregateRevenue([row({ category: '', online: 900, machineName: 'Yantra' })]);

    expect(bucket(result.byCategory, 'MACHINE')).toBe(900);
    expect(bucket(result.byMachine, 'Yantra')).toBe(900);
  });

  it('rounds to paise so float drift never leaves the invariant short', () => {
    const result = aggregateRevenue([
      row({ category: 'MACHINE', online: 0.1, machineName: 'Yantra' }),
      row({ category: 'MACHINE', online: 0.2, machineName: 'Yantra' }),
    ]);

    expect(bucket(result.byMachine, 'Yantra')).toBe(0.3);
    expect(result.totalRevenue).toBe(0.3);
    expect(sum(result.byMachine)).toBe(bucket(result.byCategory, 'MACHINE'));
  });
});
