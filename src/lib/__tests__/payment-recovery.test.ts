import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────
// markCaptureNeedsRecovery reads the Payment row's metadata, merges a
// `recovery` block in (preserving everything else), and mirrors the reason
// into failureReason — without touching `status`. We mock the data layer
// and assert the exact shape written so the /admin/payments/orphans tool
// keeps finding flagged captures.

const findUniqueMock = vi.fn();
const updateMock = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    payment: {
      findUnique: (args: unknown) => findUniqueMock(args),
      update: (args: unknown) => updateMock(args),
    },
  },
}));

import { markCaptureNeedsRecovery } from '../payment-recovery';

type UpdateArgs = {
  where: { id: string };
  data: {
    metadata: Record<string, unknown> & {
      recovery: { reason: string; handled: boolean; flaggedAt: string };
    };
    failureReason: string;
  };
};

beforeEach(() => {
  findUniqueMock.mockReset();
  updateMock.mockReset();
  updateMock.mockResolvedValue({});
});

describe('markCaptureNeedsRecovery', () => {
  it('stamps a recovery block + failureReason while preserving existing metadata', async () => {
    findUniqueMock.mockResolvedValue({ metadata: { bookingPayload: [{ slot: 1 }], receipt: 'r1' } });

    await markCaptureNeedsRecovery('pay_1', 'Booking failed: nets unavailable');

    expect(updateMock).toHaveBeenCalledTimes(1);
    const args = updateMock.mock.calls[0][0] as UpdateArgs;
    expect(args.where).toEqual({ id: 'pay_1' });
    // Existing metadata keys are preserved (so recovery can still retry).
    expect(args.data.metadata.bookingPayload).toEqual([{ slot: 1 }]);
    expect(args.data.metadata.receipt).toBe('r1');
    // Recovery block stamped with the reason and unhandled flag.
    expect(args.data.metadata.recovery.reason).toBe('Booking failed: nets unavailable');
    expect(args.data.metadata.recovery.handled).toBe(false);
    expect(typeof args.data.metadata.recovery.flaggedAt).toBe('string');
    // failureReason mirrors the reason for at-a-glance debugging.
    expect(args.data.failureReason).toBe('Booking failed: nets unavailable');
  });

  it('handles a null metadata row without throwing', async () => {
    findUniqueMock.mockResolvedValue({ metadata: null });

    await markCaptureNeedsRecovery('pay_2', 'wallet refund failed');

    const args = updateMock.mock.calls[0][0] as UpdateArgs;
    expect(args.data.metadata.recovery.reason).toBe('wallet refund failed');
    expect(args.data.failureReason).toBe('wallet refund failed');
  });
});
