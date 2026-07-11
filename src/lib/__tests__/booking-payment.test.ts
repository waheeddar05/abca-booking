import { describe, it, expect, vi, beforeEach } from 'vitest';

// booking-payment.ts imports the Prisma client at module load. The pure
// functions never touch the DB; the batch helper is tested against these
// configurable stubs.
const paymentFindMany = vi.fn();
const walletTxFindMany = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: {
    payment: { findMany: (...args: unknown[]) => paymentFindMany(...args) },
    walletTransaction: { findMany: (...args: unknown[]) => walletTxFindMany(...args) },
  },
}));

import {
  computeBookingPaymentSplit,
  getBookingPaymentSplits,
  splitAmountGross,
  splitAmountNet,
  paymentMethodLabel,
  EMPTY_SPLIT,
} from '../booking-payment';

beforeEach(() => {
  paymentFindMany.mockReset().mockResolvedValue([]);
  walletTxFindMany.mockReset().mockResolvedValue([]);
});

describe('computeBookingPaymentSplit — captured payment is authoritative', () => {
  it('single-slot online order → the payment amount, not the price', () => {
    // Real-data case: Booking.price said 550 but the captured payment
    // collected 310 — the export must report 310.
    const split = computeBookingPaymentSplit(
      { price: 550, paymentMethod: 'ONLINE' },
      [{ amount: 310, walletDeduction: 0, bookingCount: 1 }],
      0,
    );
    expect(split).toEqual({ wallet: 0, online: 310 });
  });

  it('consecutive-discount order: ₹1000 over 3 slots priced 550 each → 333 per slot', () => {
    const payment = [{ amount: 1000, walletDeduction: 0, bookingCount: 3 }];
    const split = computeBookingPaymentSplit({ price: 550, paymentMethod: 'ONLINE' }, payment, 0);
    expect(split).toEqual({ wallet: 0, online: 333 });
  });

  it('splits EVENLY, not weighted by the (mutable) per-slot prices', () => {
    // ₹700 order covering slots priced 325 and 375 → both report 350.
    const payment = [{ amount: 700, walletDeduction: 0, bookingCount: 2 }];
    expect(computeBookingPaymentSplit({ price: 325, paymentMethod: 'ONLINE' }, payment, 0))
      .toEqual({ wallet: 0, online: 350 });
    expect(computeBookingPaymentSplit({ price: 375, paymentMethod: 'ONLINE' }, payment, 0))
      .toEqual({ wallet: 0, online: 350 });
  });

  it('mixed wallet+online order: wd 650 + ₹50 online over 2 slots → 325/25 per slot', () => {
    const payment = [{ amount: 50, walletDeduction: 650, bookingCount: 2 }];
    const split = computeBookingPaymentSplit({ price: 375, paymentMethod: 'ONLINE' }, payment, 0);
    expect(split).toEqual({ wallet: 325, online: 25 });
    expect(paymentMethodLabel(split, { paymentMethod: 'ONLINE' })).toBe('Wallet + Online');
  });

  it('recorded walletDeduction of 0 beats a stray ledger debit', () => {
    // Real-data case: the wallet ledger held a ₹450 debit referencing this
    // booking (from an abandoned order), but the captured payment recorded
    // walletDeduction 0 and collected the full ₹700 online.
    const payment = [{ amount: 700, walletDeduction: 0, bookingCount: 1 }];
    const split = computeBookingPaymentSplit({ price: 700, paymentMethod: 'ONLINE' }, payment, 450);
    expect(split).toEqual({ wallet: 0, online: 700 });
    expect(paymentMethodLabel(split, { paymentMethod: 'ONLINE' })).toBe('Online');
  });

  it('legacy payment without walletDeduction metadata → ledger fallback fills the wallet', () => {
    const payment = [{ amount: 148, walletDeduction: null, bookingCount: 1 }];
    const split = computeBookingPaymentSplit({ price: 330, paymentMethod: 'ONLINE' }, payment, 163);
    expect(split).toEqual({ wallet: 163, online: 148 });
  });

  it('multiple captured payments covering the booking sum their shares', () => {
    const payments = [
      { amount: 200, walletDeduction: 0, bookingCount: 2 },
      { amount: 100, walletDeduction: 50, bookingCount: 1 },
    ];
    const split = computeBookingPaymentSplit({ price: 300, paymentMethod: 'ONLINE' }, payments, 0);
    expect(split).toEqual({ wallet: 50, online: 200 });
  });

  it('guards against a zero booking count', () => {
    const payment = [{ amount: 500, walletDeduction: 0, bookingCount: 0 }];
    expect(computeBookingPaymentSplit({ price: 500, paymentMethod: 'ONLINE' }, payment, 0))
      .toEqual({ wallet: 0, online: 500 });
  });
});

describe('computeBookingPaymentSplit — no captured payment (fallbacks)', () => {
  it('pure-wallet booking → its price, all wallet', () => {
    expect(computeBookingPaymentSplit({ price: 250, paymentMethod: 'WALLET' }, [], 0))
      .toEqual({ wallet: 250, online: 0 });
  });
  it('legacy/unlinked online booking → its price, ledger wallet carved out', () => {
    expect(computeBookingPaymentSplit({ price: 550, paymentMethod: 'ONLINE' }, [], 240))
      .toEqual({ wallet: 240, online: 310 });
  });
  it('ledger wallet is capped at the price', () => {
    expect(computeBookingPaymentSplit({ price: 550, paymentMethod: 'ONLINE' }, [], 800))
      .toEqual({ wallet: 550, online: 0 });
  });
  it('cash / free / package-covered → 0 / 0', () => {
    expect(computeBookingPaymentSplit({ price: 550, paymentMethod: 'CASH' }, [], 0))
      .toEqual({ wallet: 0, online: 0 });
    expect(computeBookingPaymentSplit({ price: 550, paymentMethod: null }, [], 0))
      .toEqual({ wallet: 0, online: 0 });
  });
});

describe('splitAmountGross / splitAmountNet', () => {
  it('gross = wallet + online', () => {
    expect(splitAmountGross({ wallet: 163, online: 148 })).toBe(311);
    expect(splitAmountGross(EMPTY_SPLIT)).toBe(0);
  });
  it('net subtracts non-failed refunds only', () => {
    expect(splitAmountNet({ wallet: 0, online: 550 }, [{ amount: 100, status: 'PROCESSED' }])).toBe(450);
    expect(splitAmountNet({ wallet: 0, online: 550 }, [{ amount: 100, status: 'FAILED' }])).toBe(550);
    expect(splitAmountNet({ wallet: 0, online: 550 }, [])).toBe(550);
  });
  it('net clamps at 0 when a price-sized refund exceeds the even share', () => {
    // 3-slot ₹1000 order (share 333); the cancelled slot was refunded its
    // ₹550 price → the row reads ₹0 collected, not −217.
    expect(splitAmountNet({ wallet: 0, online: 333 }, [{ amount: 550, status: 'PROCESSED' }])).toBe(0);
  });
});

describe('getBookingPaymentSplits (batch, DB-aware)', () => {
  it('resolves every booking in the order from one payment row', async () => {
    paymentFindMany.mockResolvedValue([
      {
        amount: 1000,
        metadata: { walletDeduction: 0 },
        bookingIds: ['b1', 'b2', 'b3'],
      },
    ]);
    const splits = await getBookingPaymentSplits([
      { id: 'b1', price: 550, paymentMethod: 'ONLINE' },
      { id: 'b2', price: 550, paymentMethod: 'ONLINE' },
      { id: 'b3', price: 550, paymentMethod: 'ONLINE' },
    ]);
    expect(splits.get('b1')).toEqual({ wallet: 0, online: 333 });
    expect(splits.get('b2')).toEqual({ wallet: 0, online: 333 });
    expect(splits.get('b3')).toEqual({ wallet: 0, online: 333 });
    // Every payment recorded its wallet deduction → the ledger is not consulted.
    expect(walletTxFindMany).not.toHaveBeenCalled();
  });

  it('queries every collected-money status — a refund must not hide the order', async () => {
    // Refund flows flip CAPTURED → PARTIALLY_REFUNDED / REFUNDED while the
    // payment still records the captured gross; filtering to CAPTURED alone
    // would revert refund-touched orders to the price basis.
    await getBookingPaymentSplits([{ id: 'b1', price: 100, paymentMethod: 'ONLINE' }]);
    expect(paymentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ['CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED'] },
        }),
      }),
    );
  });

  it('partially-refunded order: active sibling keeps its even payment share', async () => {
    paymentFindMany.mockResolvedValue([
      { amount: 1000, metadata: { walletDeduction: 0 }, bookingIds: ['a', 'b'] },
    ]);
    const splits = await getBookingPaymentSplits([
      { id: 'a', price: 550, paymentMethod: 'ONLINE' },
      { id: 'b', price: 450, paymentMethod: 'ONLINE' },
    ]);
    expect(splits.get('a')).toEqual({ wallet: 0, online: 500 });
    // The cancelled slot nets to 0 once its refund is applied.
    expect(splitAmountNet(splits.get('b')!, [{ amount: 450, status: 'PROCESSED' }])).toBe(50);
  });

  it('falls back to the wallet ledger for legacy payments without walletDeduction', async () => {
    paymentFindMany.mockResolvedValueOnce([
      { amount: 148, metadata: {}, bookingIds: ['b1'] },
    ]);
    walletTxFindMany.mockResolvedValue([{ referenceId: 'b1', amount: 163 }]);
    const splits = await getBookingPaymentSplits([
      { id: 'b1', price: 330, paymentMethod: 'ONLINE' },
    ]);
    expect(splits.get('b1')).toEqual({ wallet: 163, online: 148 });
    // Order grouping reuses the already-fetched payments — no second
    // Payment lookup.
    expect(paymentFindMany).toHaveBeenCalledTimes(1);
  });

  it('finds the order wallet debit even when its referenced sibling is outside the batch', async () => {
    // Legacy 2-slot order [a, b]: the single wallet debit references slot a,
    // but the caller (a paginated list / filtered export) only asked about b.
    paymentFindMany.mockResolvedValueOnce([
      { amount: 296, metadata: {}, bookingIds: ['a', 'b'] },
    ]);
    walletTxFindMany.mockResolvedValue([{ referenceId: 'a', amount: 326 }]);
    const splits = await getBookingPaymentSplits([
      { id: 'b', price: 330, paymentMethod: 'ONLINE' },
    ]);
    // The ledger lookup must include sibling a's id…
    expect(walletTxFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          referenceId: { in: expect.arrayContaining(['a', 'b']) },
        }),
      }),
    );
    // …so b gets its even share of the order's wallet: 326/2 + 296/2.
    expect(splits.get('b')).toEqual({ wallet: 163, online: 148 });
  });

  it('rethrows transient DB errors instead of silently serving price-based numbers', async () => {
    paymentFindMany.mockRejectedValue(Object.assign(new Error('conn lost'), { code: 'P1001' }));
    await expect(
      getBookingPaymentSplits([{ id: 'b1', price: 100, paymentMethod: 'ONLINE' }]),
    ).rejects.toThrow('conn lost');
  });

  it('absorbs only the missing-table error (unmigrated environments)', async () => {
    paymentFindMany.mockRejectedValue(Object.assign(new Error('no table'), { code: 'P2021' }));
    walletTxFindMany.mockRejectedValue(Object.assign(new Error('no table'), { code: 'P2021' }));
    const splits = await getBookingPaymentSplits([
      { id: 'b1', price: 100, paymentMethod: 'ONLINE' },
    ]);
    expect(splits.get('b1')).toEqual({ wallet: 0, online: 100 });
  });

  it('bookings with no payment row fall back by method', async () => {
    paymentFindMany.mockResolvedValue([]);
    const splits = await getBookingPaymentSplits([
      { id: 'w1', price: 250, paymentMethod: 'WALLET' },
      { id: 'c1', price: 550, paymentMethod: 'CASH' },
      { id: 'p1', price: 0, paymentMethod: null },
    ]);
    expect(splits.get('w1')).toEqual({ wallet: 250, online: 0 });
    expect(splits.get('c1')).toEqual({ wallet: 0, online: 0 });
    expect(splits.get('p1')).toEqual({ wallet: 0, online: 0 });
  });

  it('returns an empty map for no input', async () => {
    expect((await getBookingPaymentSplits([])).size).toBe(0);
    expect(paymentFindMany).not.toHaveBeenCalled();
  });
});

describe('paymentMethodLabel', () => {
  it('derives the label from the split', () => {
    expect(paymentMethodLabel({ wallet: 240, online: 310 }, { paymentMethod: 'ONLINE' })).toBe('Wallet + Online');
    expect(paymentMethodLabel({ wallet: 250, online: 0 }, { paymentMethod: 'WALLET' })).toBe('Wallet');
    expect(paymentMethodLabel({ wallet: 0, online: 550 }, { paymentMethod: 'ONLINE' })).toBe('Online');
  });
  it('cash rows read Cash', () => {
    expect(paymentMethodLabel({ wallet: 0, online: 0 }, { paymentMethod: 'CASH' })).toBe('Cash');
  });
  it('nothing collected → NA (package sessions, free bookings)', () => {
    expect(paymentMethodLabel({ wallet: 0, online: 0 }, { paymentMethod: null, isPackage: true })).toBe('NA');
  });
});
