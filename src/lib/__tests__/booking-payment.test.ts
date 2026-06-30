import { describe, it, expect, vi } from 'vitest';

// booking-payment.ts imports the Prisma client at module load for the
// DB-aware helper. The pure functions under test never touch the DB, so a
// stub keeps the import from initialising a real client in the test env.
vi.mock('@/lib/prisma', () => ({ prisma: {} }));

import {
  computeBookingPaymentSplit,
  paymentMethodLabel,
  type PaymentForSplit,
} from '../booking-payment';

describe('computeBookingPaymentSplit', () => {
  it('online-only payment → full amount under online', () => {
    const payment: PaymentForSplit = { amount: 450, metadata: {}, bookingIds: ['b1'] };
    const prices = new Map([['b1', 450]]);
    expect(
      computeBookingPaymentSplit({ id: 'b1', price: 450, paymentMethod: 'ONLINE' }, payment, prices),
    ).toEqual({ wallet: 0, online: 450 });
  });

  it('package upgrade paid online (the Shubham ₹50 case) → Online, not NA', () => {
    // Package-redemption booking: price = the upgrade/extra charge, paid online.
    const payment: PaymentForSplit = { amount: 50, metadata: {}, bookingIds: ['pkg1'] };
    const prices = new Map([['pkg1', 50]]);
    const split = computeBookingPaymentSplit(
      { id: 'pkg1', price: 50, paymentMethod: 'ONLINE' },
      payment,
      prices,
    );
    expect(split).toEqual({ wallet: 0, online: 50 });
    expect(paymentMethodLabel(split, { paymentMethod: 'ONLINE', isPackage: true })).toBe('Online');
  });

  it('mixed wallet + online payment splits by metadata.walletDeduction', () => {
    const payment: PaymentForSplit = { amount: 300, metadata: { walletDeduction: 150 }, bookingIds: ['b1'] };
    const prices = new Map([['b1', 450]]);
    expect(
      computeBookingPaymentSplit({ id: 'b1', price: 450, paymentMethod: 'ONLINE' }, payment, prices),
    ).toEqual({ wallet: 150, online: 300 });
  });

  it('pro-rates a multi-booking order across its bookings', () => {
    // One order of ₹600 online + ₹200 wallet covering two ₹400 bookings.
    const payment: PaymentForSplit = {
      amount: 600,
      metadata: { walletDeduction: 200 },
      bookingIds: ['b1', 'b2'],
    };
    const prices = new Map([['b1', 400], ['b2', 400]]);
    expect(
      computeBookingPaymentSplit({ id: 'b1', price: 400, paymentMethod: 'ONLINE' }, payment, prices),
    ).toEqual({ wallet: 100, online: 300 });
  });

  it('pure wallet booking (no payment row) → full price under wallet', () => {
    expect(
      computeBookingPaymentSplit({ id: 'b1', price: 250, paymentMethod: 'WALLET' }, undefined, new Map()),
    ).toEqual({ wallet: 250, online: 0 });
  });

  it('legacy/unlinked online booking (no payment row) approximated by price', () => {
    expect(
      computeBookingPaymentSplit({ id: 'b1', price: 250, paymentMethod: 'ONLINE' }, undefined, new Map()),
    ).toEqual({ wallet: 0, online: 250 });
  });

  it('cash booking collects nothing digitally → {0,0}', () => {
    expect(
      computeBookingPaymentSplit({ id: 'b1', price: 250, paymentMethod: 'CASH' }, undefined, new Map()),
    ).toEqual({ wallet: 0, online: 0 });
  });

  it('package session with no extra (price 0, no payment) → {0,0}', () => {
    expect(
      computeBookingPaymentSplit({ id: 'pkg1', price: 0, paymentMethod: null }, undefined, new Map()),
    ).toEqual({ wallet: 0, online: 0 });
  });
});

describe('paymentMethodLabel', () => {
  it('labels a mixed payment', () => {
    expect(paymentMethodLabel({ wallet: 100, online: 300 }, { paymentMethod: 'ONLINE' })).toBe('Wallet + Online');
  });
  it('labels wallet-only and online-only', () => {
    expect(paymentMethodLabel({ wallet: 100, online: 0 }, { paymentMethod: 'WALLET' })).toBe('Wallet');
    expect(paymentMethodLabel({ wallet: 0, online: 300 }, { paymentMethod: 'ONLINE' })).toBe('Online');
  });
  it('labels cash', () => {
    expect(paymentMethodLabel({ wallet: 0, online: 0 }, { paymentMethod: 'CASH' })).toBe('Cash');
  });
  it('labels a paid-at-purchase package session / free booking as NA', () => {
    expect(paymentMethodLabel({ wallet: 0, online: 0 }, { paymentMethod: null, isPackage: true })).toBe('NA');
  });
});
