import { describe, it, expect, vi, beforeEach } from 'vitest';

// booking-hold pulls in prisma + wallet + notifications + policy. Stub them
// so we can unit-test the confirm/expiry/flag logic in isolation.
vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: { findMany: vi.fn(), updateMany: vi.fn() },
    payment: { findUnique: vi.fn(), update: vi.fn() },
  },
}));
vi.mock('@/lib/policy', () => ({ isPolicyEnabled: vi.fn() }));
vi.mock('@/lib/wallet', () => ({ debitWallet: vi.fn() }));
vi.mock('@/lib/notifications', () => ({
  notifyCustomerNewBooking: vi.fn(),
  notifyAssignedStaffNewBooking: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  confirmHeldBookings,
  newHoldExpiry,
  HOLD_TTL_MS,
  isReserveBeforePayment,
} from '../booking-hold';
import { prisma } from '@/lib/prisma';
import { isPolicyEnabled } from '@/lib/policy';
import { debitWallet } from '@/lib/wallet';

const booking = prisma.booking as unknown as { findMany: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
const payment = prisma.payment as unknown as { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
  payment.update.mockResolvedValue({});
});

describe('newHoldExpiry / TTL', () => {
  it('is 20 minutes', () => {
    expect(HOLD_TTL_MS).toBe(20 * 60 * 1000);
  });
  it('returns now + TTL', () => {
    const now = 1_000_000;
    expect(newHoldExpiry(now).getTime()).toBe(now + HOLD_TTL_MS);
  });
});

describe('isReserveBeforePayment', () => {
  it('reads the RESERVE_BEFORE_PAYMENT policy (default false)', async () => {
    (isPolicyEnabled as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
    expect(await isReserveBeforePayment('c1')).toBe(true);
    expect(isPolicyEnabled).toHaveBeenCalledWith('RESERVE_BEFORE_PAYMENT', 'c1', false);
  });
  it('fails safe to false when the policy lookup throws', async () => {
    (isPolicyEnabled as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('db down'));
    expect(await isReserveBeforePayment('c1')).toBe(false);
  });
});

describe('confirmHeldBookings', () => {
  it('returns {confirmed:false} when no bookings are linked to the payment (flag off / swept)', async () => {
    booking.findMany.mockResolvedValueOnce([]); // no HOLD/BOOKED rows
    const res = await confirmHeldBookings('pay_none');
    expect(res).toEqual({ confirmed: false });
    expect(booking.updateMany).not.toHaveBeenCalled();
  });

  it('is idempotent: already-BOOKED rows return alreadyConfirmed without re-flipping', async () => {
    booking.findMany.mockResolvedValueOnce([
      { id: 'b1', status: 'BOOKED' },
      { id: 'b2', status: 'BOOKED' },
    ]);
    const res = await confirmHeldBookings('pay_done');
    expect(res).toMatchObject({ confirmed: true, alreadyConfirmed: true });
    expect(booking.updateMany).not.toHaveBeenCalled();
  });

  it('flips HOLD→BOOKED, links the payment, debits the wallet portion and notifies', async () => {
    booking.findMany
      .mockResolvedValueOnce([
        { id: 'b1', status: 'HOLD' },
        { id: 'b2', status: 'HOLD' },
      ]) // first lookup (HOLD|BOOKED)
      .mockResolvedValueOnce([
        { id: 'b1', status: 'BOOKED' },
        { id: 'b2', status: 'BOOKED' },
      ]); // re-read after flip (BOOKED|DONE)
    booking.updateMany.mockResolvedValueOnce({ count: 2 });
    payment.findUnique.mockResolvedValueOnce({
      id: 'pay1',
      userId: 'u1',
      centerId: 'c1',
      metadata: { walletDeduction: 150 },
    });

    const res = await confirmHeldBookings('pay1');

    expect(res).toMatchObject({ confirmed: true, alreadyConfirmed: false });
    // flipped exactly the HOLD rows to BOOKED/PAID
    const flipArg = booking.updateMany.mock.calls[0][0];
    expect(flipArg.where).toMatchObject({ id: { in: ['b1', 'b2'] }, status: 'HOLD' });
    expect(flipArg.data).toMatchObject({ status: 'BOOKED', paymentStatus: 'PAID' });
    // linked payment → bookings
    expect(payment.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'pay1' }, data: { bookingIds: ['b1', 'b2'] } }),
    );
    // wallet portion debited
    expect(debitWallet).toHaveBeenCalledWith('u1', 'c1', 150, 'DEBIT_BOOKING', expect.any(String), 'b1');
  });

  it('does not debit wallet when there is no wallet portion', async () => {
    booking.findMany
      .mockResolvedValueOnce([{ id: 'b1', status: 'HOLD' }])
      .mockResolvedValueOnce([{ id: 'b1', status: 'BOOKED' }]);
    booking.updateMany.mockResolvedValueOnce({ count: 1 });
    payment.findUnique.mockResolvedValueOnce({ id: 'p', userId: 'u', centerId: 'c', metadata: { walletDeduction: 0 } });

    await confirmHeldBookings('p');
    expect(debitWallet).not.toHaveBeenCalled();
  });
});
