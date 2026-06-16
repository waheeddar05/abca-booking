import { describe, it, expect, vi } from 'vitest';

// payment-reconcile pulls in prisma, the razorpay SDK and the (very
// heavy) booking route modules at import time. Stub them all so the unit
// under test — the pure `decideReconcileAction` — imports cleanly.
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/razorpay', () => ({ fetchOrderPayments: vi.fn() }));
vi.mock('@/lib/payment-recovery', () => ({ markCaptureNeedsRecovery: vi.fn() }));
vi.mock('@/lib/package-purchase', () => ({ completePackagePurchase: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/app/api/slots/book/route', () => ({ executeSlotBooking: vi.fn() }));
vi.mock('@/app/api/slots/book-resource/route', () => ({
  executeResourceBooking: vi.fn(),
  ResourceBookingBodySchema: { safeParse: vi.fn() },
}));

import { decideReconcileAction } from '../payment-reconcile';

const base = {
  status: 'CREATED',
  paymentType: 'SLOT_BOOKING',
  bookingIds: [] as string[],
  userPackageId: null as string | null,
  razorpayPaymentId: null as string | null,
};

const captured = (id = 'pay_captured') => ({ items: [{ id, status: 'captured' }] });

describe('decideReconcileAction', () => {
  it('CREATED + Razorpay reports captured → finalize with that payment id', () => {
    expect(decideReconcileAction({ ...base }, captured('pay_abc'))).toEqual({
      action: 'finalize',
      razorpayPaymentId: 'pay_abc',
    });
  });

  it('CREATED + Razorpay has no captured payment → skip as unpaid (genuinely abandoned)', () => {
    const decision = decideReconcileAction(
      { ...base },
      { items: [{ id: 'p1', status: 'failed' }, { id: 'p2', status: 'created' }] },
    );
    expect(decision).toEqual({ action: 'skip_unpaid' });
  });

  it('CREATED + no Razorpay data at all → skip as unpaid', () => {
    expect(decideReconcileAction({ ...base }, null)).toEqual({ action: 'skip_unpaid' });
    expect(decideReconcileAction({ ...base }, { items: [] })).toEqual({ action: 'skip_unpaid' });
  });

  it('CAPTURED orphan with stored razorpayPaymentId → finalize using the stored id', () => {
    const decision = decideReconcileAction(
      { ...base, status: 'CAPTURED', razorpayPaymentId: 'pay_stored' },
      captured('pay_fromRzp'),
    );
    expect(decision).toEqual({ action: 'finalize', razorpayPaymentId: 'pay_stored' });
  });

  it('CAPTURED orphan WITHOUT a stored id → falls back to the captured id from Razorpay', () => {
    const decision = decideReconcileAction(
      { ...base, status: 'CAPTURED', razorpayPaymentId: null },
      captured('pay_fromRzp'),
    );
    expect(decision).toEqual({ action: 'finalize', razorpayPaymentId: 'pay_fromRzp' });
  });

  it('CAPTURED without stored id and Razorpay shows nothing captured → skip_unpaid', () => {
    const decision = decideReconcileAction(
      { ...base, status: 'CAPTURED', razorpayPaymentId: null },
      { items: [{ id: 'p', status: 'authorized' }] },
    );
    expect(decision).toEqual({ action: 'skip_unpaid' });
  });

  it('SLOT_BOOKING already has bookings → skip_done (never re-create)', () => {
    const decision = decideReconcileAction(
      { ...base, status: 'CAPTURED', bookingIds: ['bk_1'], razorpayPaymentId: 'pay_x' },
      captured(),
    );
    expect(decision).toEqual({ action: 'skip_done' });
  });

  it('REFUNDED → skip_done even if Razorpay still shows a captured payment', () => {
    expect(
      decideReconcileAction({ ...base, status: 'REFUNDED' }, captured()),
    ).toEqual({ action: 'skip_done' });
  });

  it('FAILED → skip_done', () => {
    expect(
      decideReconcileAction({ ...base, status: 'FAILED' }, captured()),
    ).toEqual({ action: 'skip_done' });
  });

  it('PACKAGE_PURCHASE already completed (userPackageId set) → skip_done', () => {
    const decision = decideReconcileAction(
      { ...base, paymentType: 'PACKAGE_PURCHASE', status: 'CAPTURED', userPackageId: 'up_1' },
      captured(),
    );
    expect(decision).toEqual({ action: 'skip_done' });
  });

  it('PACKAGE_PURCHASE CREATED + captured → finalize', () => {
    const decision = decideReconcileAction(
      { ...base, paymentType: 'PACKAGE_PURCHASE' },
      captured('pay_pkg'),
    );
    expect(decision).toEqual({ action: 'finalize', razorpayPaymentId: 'pay_pkg' });
  });

  it('picks the captured item even when other attempts failed first', () => {
    const decision = decideReconcileAction(
      { ...base },
      { items: [{ id: 'p_failed', status: 'failed' }, { id: 'p_ok', status: 'captured' }] },
    );
    expect(decision).toEqual({ action: 'finalize', razorpayPaymentId: 'p_ok' });
  });
});
