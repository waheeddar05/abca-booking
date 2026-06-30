import { describe, it, expect, vi } from 'vitest';

// booking-payment.ts imports the Prisma client at module load for the
// DB-aware helper. The pure functions under test never touch the DB, so a
// stub keeps the import from initialising a real client in the test env.
vi.mock('@/lib/prisma', () => ({ prisma: {} }));

import {
  bookingAmountPaidGross,
  bookingAmountPaidNet,
  bookingPaymentSplit,
  paymentMethodLabel,
} from '../booking-payment';

describe('bookingAmountPaidGross', () => {
  it('online booking → its price', () => {
    expect(bookingAmountPaidGross({ price: 550, paymentMethod: 'ONLINE' })).toBe(550);
  });
  it('wallet booking → its price', () => {
    expect(bookingAmountPaidGross({ price: 250, paymentMethod: 'WALLET' })).toBe(250);
  });
  it('cash booking → 0 (excluded, digital-only)', () => {
    expect(bookingAmountPaidGross({ price: 550, paymentMethod: 'CASH' })).toBe(0);
  });
  it('package-covered / pay-later (no method) → 0', () => {
    expect(bookingAmountPaidGross({ price: 0, paymentMethod: null })).toBe(0);
    expect(bookingAmountPaidGross({ price: 550, paymentMethod: null })).toBe(0);
  });
  it('online package upgrade (the Shubham ₹50 case) → 50', () => {
    expect(bookingAmountPaidGross({ price: 50, paymentMethod: 'ONLINE' })).toBe(50);
  });
});

describe('bookingAmountPaidNet', () => {
  it('subtracts non-failed refunds', () => {
    expect(
      bookingAmountPaidNet({ price: 550, paymentMethod: 'ONLINE' }, [{ amount: 100, status: 'PROCESSED' }]),
    ).toBe(450);
  });
  it('ignores FAILED refunds', () => {
    expect(
      bookingAmountPaidNet({ price: 550, paymentMethod: 'ONLINE' }, [{ amount: 100, status: 'FAILED' }]),
    ).toBe(550);
  });
  it('a cancelled slot fully refunded nets to 0 (no more phantom ₹600)', () => {
    // The 10:00 Gravity slot: charged 600, fully refunded to wallet on cancel.
    expect(
      bookingAmountPaidNet({ price: 600, paymentMethod: 'ONLINE' }, [{ amount: 600, status: 'PROCESSED' }]),
    ).toBe(0);
  });
  it('an active consecutive slot shows its own price, not a pro-rated fraction', () => {
    // The 08:30 / 09:00 Gravity slots: each charged 550, no refund → 550 each,
    // instead of the old 310/550 pro-rating artifacts.
    expect(bookingAmountPaidNet({ price: 550, paymentMethod: 'ONLINE' }, [])).toBe(550);
  });
});

describe('bookingPaymentSplit', () => {
  it('pure online booking → all online', () => {
    expect(bookingPaymentSplit({ price: 550, paymentMethod: 'ONLINE' }, 0)).toEqual({ wallet: 0, online: 550 });
  });
  it('pure wallet booking → all wallet (ledger debit ignored, method is authoritative)', () => {
    expect(bookingPaymentSplit({ price: 250, paymentMethod: 'WALLET' }, 999)).toEqual({ wallet: 250, online: 0 });
  });
  it('part-wallet + online → wallet from ledger, remainder online', () => {
    // Charged 550 for the slot, ₹240 came from wallet → ₹310 online.
    expect(bookingPaymentSplit({ price: 550, paymentMethod: 'ONLINE' }, 240)).toEqual({ wallet: 240, online: 310 });
  });
  it('caps wallet at the slot amount (sum never exceeds what was charged)', () => {
    // Multi-slot order debits the whole wallet against the first slot; cap so
    // wallet + online == this slot's charge.
    expect(bookingPaymentSplit({ price: 550, paymentMethod: 'ONLINE' }, 800)).toEqual({ wallet: 550, online: 0 });
  });
  it('cash / package-covered → 0 / 0', () => {
    expect(bookingPaymentSplit({ price: 550, paymentMethod: 'CASH' }, 0)).toEqual({ wallet: 0, online: 0 });
    expect(bookingPaymentSplit({ price: 0, paymentMethod: null }, 0)).toEqual({ wallet: 0, online: 0 });
  });
});

describe('paymentMethodLabel', () => {
  it('labels mixed / wallet / online', () => {
    expect(paymentMethodLabel({ wallet: 240, online: 310 }, { paymentMethod: 'ONLINE' })).toBe('Wallet + Online');
    expect(paymentMethodLabel({ wallet: 250, online: 0 }, { paymentMethod: 'WALLET' })).toBe('Wallet');
    expect(paymentMethodLabel({ wallet: 0, online: 550 }, { paymentMethod: 'ONLINE' })).toBe('Online');
  });
  it('labels cash', () => {
    expect(paymentMethodLabel({ wallet: 0, online: 0 }, { paymentMethod: 'CASH' })).toBe('Cash');
  });
  it('labels a paid-at-purchase package session / free booking as NA', () => {
    expect(paymentMethodLabel({ wallet: 0, online: 0 }, { paymentMethod: null, isPackage: true })).toBe('NA');
  });
});
