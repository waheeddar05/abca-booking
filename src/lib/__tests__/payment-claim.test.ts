import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Fake Payment table that models the two things this module depends on
 * Postgres for:
 *   • `updateMany` evaluates its `where` against the *current* row and
 *     reports how many rows it actually changed;
 *   • a row update is indivisible — no other caller can observe a
 *     half-applied claim.
 *
 * That's enough to test the predicates. The DB supplies the atomicity.
 */
type Row = {
  id: string;
  status: string;
  bookingIds: string[];
  userPackageId: string | null;
  razorpayPaymentId: string | null;
  razorpaySignature: string | null;
  bookingClaimAt: Date | null;
  bookingClaimBy: string | null;
};

const rows = new Map<string, Row>();

function matches(row: Row, where: Record<string, unknown>): boolean {
  for (const [key, cond] of Object.entries(where)) {
    if (key === 'OR') {
      const clauses = cond as Record<string, unknown>[];
      if (!clauses.some((c) => matches(row, c))) return false;
      continue;
    }
    const value = (row as unknown as Record<string, unknown>)[key];
    if (cond !== null && typeof cond === 'object') {
      const c = cond as Record<string, unknown>;
      if ('isEmpty' in c) {
        if (((value as unknown[]).length === 0) !== c.isEmpty) return false;
      }
      if ('lt' in c) {
        if (value === null) return false;
        if (!((value as Date).getTime() < (c.lt as Date).getTime())) return false;
      }
      continue;
    }
    if (value !== cond) return false;
  }
  return true;
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    payment: {
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const row = rows.get(where.id as string);
        if (!row || !matches(row, where)) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const row = rows.get(where.id);
        return row ? { ...row } : null;
      }),
    },
  },
}));
vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  BOOKING_LEASE_MS,
  isFulfilled,
  claimCaptureAndBooking,
  claimBookingLease,
  releaseBookingLease,
  waitForFulfilment,
} from '../payment-claim';

const PAY = 'pay_1';

function seed(overrides: Partial<Row> = {}) {
  rows.clear();
  rows.set(PAY, {
    id: PAY,
    status: 'CREATED',
    bookingIds: [],
    userPackageId: null,
    razorpayPaymentId: null,
    razorpaySignature: null,
    bookingClaimAt: null,
    bookingClaimBy: null,
    ...overrides,
  });
  return rows.get(PAY)!;
}

describe('isFulfilled', () => {
  const base = { status: 'CAPTURED', bookingIds: [] as string[], userPackageId: null as string | null };

  it('SLOT_BOOKING is fulfilled once it has bookings', () => {
    expect(isFulfilled(base, 'SLOT_BOOKING')).toBe(false);
    expect(isFulfilled({ ...base, bookingIds: ['bk_1'] }, 'SLOT_BOOKING')).toBe(true);
  });

  it('PACKAGE_PURCHASE is fulfilled once it has a userPackage', () => {
    expect(isFulfilled(base, 'PACKAGE_PURCHASE')).toBe(false);
    expect(isFulfilled({ ...base, userPackageId: 'up_1' }, 'PACKAGE_PURCHASE')).toBe(true);
  });

  it('a refunded payment is terminal for either kind', () => {
    expect(isFulfilled({ ...base, status: 'REFUNDED' }, 'SLOT_BOOKING')).toBe(true);
    expect(isFulfilled({ ...base, status: 'REFUNDED' }, 'PACKAGE_PURCHASE')).toBe(true);
  });
});

describe('claimCaptureAndBooking', () => {
  beforeEach(() => seed());

  it('takes the capture flip and the lease in one step', async () => {
    const res = await claimCaptureAndBooking({
      paymentId: PAY,
      razorpayPaymentId: 'pay_rzp',
      razorpaySignature: 'sig',
      holder: 'verify',
    });
    expect(res.outcome).toBe('won');
    const row = rows.get(PAY)!;
    expect(row.status).toBe('CAPTURED');
    expect(row.razorpayPaymentId).toBe('pay_rzp');
    expect(row.razorpaySignature).toBe('sig');
    // The lease is the point: the winner is never left looking like an
    // unclaimed orphan while it books.
    expect(row.bookingClaimAt).toBeInstanceOf(Date);
    expect(row.bookingClaimBy).toBe('verify');
  });

  it('exactly one of several concurrent callers wins', async () => {
    const results = await Promise.all(
      ['verify', 'webhook', 'reconcile/self'].map((holder) =>
        claimCaptureAndBooking({ paymentId: PAY, razorpayPaymentId: 'pay_rzp', holder }),
      ),
    );
    expect(results.filter((r) => r.outcome === 'won')).toHaveLength(1);
  });

  it('a payment already CAPTURED cannot be re-claimed through the flip', async () => {
    seed({ status: 'CAPTURED' });
    const res = await claimCaptureAndBooking({ paymentId: PAY, razorpayPaymentId: 'p', holder: 'webhook' });
    expect(res.outcome).toBe('lost');
  });
});

describe('claimBookingLease', () => {
  beforeEach(() => seed({ status: 'CAPTURED' }));

  it('grants the lease on an unclaimed captured orphan', async () => {
    const res = await claimBookingLease({ paymentId: PAY, kind: 'SLOT_BOOKING', holder: 'reconcile/cron' });
    expect(res.outcome).toBe('won');
    expect(rows.get(PAY)!.bookingClaimBy).toBe('reconcile/cron');
  });

  /**
   * The production incident, reduced: two `recover-mine` calls a few
   * seconds apart on one order. The first is inside the booking engine
   * (CAPTURED, lease held, bookingIds not written yet) when the second
   * arrives and sees a row that looks exactly like an orphan.
   * Pre-fix the second one booked; it must now stand down.
   */
  it('refuses a second finalizer while the first is still booking', async () => {
    const first = await claimBookingLease({ paymentId: PAY, kind: 'SLOT_BOOKING', holder: 'reconcile/self#1' });
    expect(first.outcome).toBe('won');

    const second = await claimBookingLease({ paymentId: PAY, kind: 'SLOT_BOOKING', holder: 'reconcile/self#2' });
    expect(second.outcome).toBe('busy');
    if (second.outcome === 'busy') expect(second.heldBy).toBe('reconcile/self#1');
  });

  it('exactly one of several concurrent finalizers wins the lease', async () => {
    const results = await Promise.all(
      ['a', 'b', 'c', 'd'].map((holder) =>
        claimBookingLease({ paymentId: PAY, kind: 'SLOT_BOOKING', holder }),
      ),
    );
    expect(results.filter((r) => r.outcome === 'won')).toHaveLength(1);
    expect(results.filter((r) => r.outcome === 'busy')).toHaveLength(3);
  });

  it('reports already_fulfilled — not busy — once bookings exist', async () => {
    seed({ status: 'CAPTURED', bookingIds: ['bk_1', 'bk_2'] });
    const res = await claimBookingLease({ paymentId: PAY, kind: 'SLOT_BOOKING', holder: 'webhook' });
    expect(res.outcome).toBe('already_fulfilled');
    if (res.outcome === 'already_fulfilled') expect(res.bookingIds).toEqual(['bk_1', 'bk_2']);
  });

  it('steals a stale lease so a crashed finalizer cannot wedge the payment', async () => {
    seed({
      status: 'CAPTURED',
      bookingClaimAt: new Date(Date.now() - BOOKING_LEASE_MS - 1_000),
      bookingClaimBy: 'reconcile/cron',
    });
    const res = await claimBookingLease({ paymentId: PAY, kind: 'SLOT_BOOKING', holder: 'reconcile/self' });
    expect(res.outcome).toBe('won');
    expect(rows.get(PAY)!.bookingClaimBy).toBe('reconcile/self');
  });

  it('does not grant a lease on a payment that is not CAPTURED', async () => {
    seed({ status: 'CREATED' });
    const res = await claimBookingLease({ paymentId: PAY, kind: 'SLOT_BOOKING', holder: 'webhook' });
    expect(res.outcome).toBe('busy');
  });

  it('a package purchase is fulfilled by userPackageId, not bookingIds', async () => {
    seed({ status: 'CAPTURED', userPackageId: 'up_9' });
    expect(
      (await claimBookingLease({ paymentId: PAY, kind: 'PACKAGE_PURCHASE', holder: 'x' })).outcome,
    ).toBe('already_fulfilled');
    // …and the same row is still claimable as a slot booking, proving the
    // two kinds don't read each other's completion marker.
    expect(
      (await claimBookingLease({ paymentId: PAY, kind: 'SLOT_BOOKING', holder: 'x' })).outcome,
    ).toBe('won');
  });

  it('reports gone when the payment row has vanished', async () => {
    rows.clear();
    const res = await claimBookingLease({ paymentId: PAY, kind: 'SLOT_BOOKING', holder: 'x' });
    expect(res.outcome).toBe('gone');
  });
});

describe('releaseBookingLease', () => {
  it('frees the lease so the next path can take it', async () => {
    seed({ status: 'CAPTURED' });
    await claimBookingLease({ paymentId: PAY, kind: 'SLOT_BOOKING', holder: 'verify' });
    await releaseBookingLease(PAY, 'verify');
    expect(rows.get(PAY)!.bookingClaimAt).toBeNull();
    expect(
      (await claimBookingLease({ paymentId: PAY, kind: 'SLOT_BOOKING', holder: 'reconcile/cron' })).outcome,
    ).toBe('won');
  });

  it('never clears a lease held by someone else', async () => {
    seed({ status: 'CAPTURED' });
    await claimBookingLease({ paymentId: PAY, kind: 'SLOT_BOOKING', holder: 'reconcile/cron' });
    // A path whose own lease expired and was stolen must not wipe the
    // new holder's claim on its way out.
    await releaseBookingLease(PAY, 'verify');
    expect(rows.get(PAY)!.bookingClaimBy).toBe('reconcile/cron');
  });
});

describe('waitForFulfilment', () => {
  it('returns as soon as the holder links its bookings', async () => {
    seed({ status: 'CAPTURED' });
    setTimeout(() => {
      rows.get(PAY)!.bookingIds = ['bk_1'];
    }, 30);
    const res = await waitForFulfilment({
      paymentId: PAY,
      kind: 'SLOT_BOOKING',
      timeoutMs: 1_000,
      intervalMs: 10,
    });
    expect(res?.bookingIds).toEqual(['bk_1']);
  });

  it('returns null when the holder never finishes, so the caller can flag it', async () => {
    seed({ status: 'CAPTURED' });
    const res = await waitForFulfilment({
      paymentId: PAY,
      kind: 'SLOT_BOOKING',
      timeoutMs: 40,
      intervalMs: 10,
    });
    expect(res).toBeNull();
  });

  it('treats a refund as a terminal outcome and stops waiting', async () => {
    seed({ status: 'REFUNDED' });
    const res = await waitForFulfilment({ paymentId: PAY, kind: 'SLOT_BOOKING', timeoutMs: 1_000, intervalMs: 10 });
    expect(res?.status).toBe('REFUNDED');
  });
});
