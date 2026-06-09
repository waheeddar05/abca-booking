import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────
// notifyAdminPaymentIssue resolves the center's active ADMIN memberships
// and alerts each one in-app (always) + WhatsApp (best-effort). We mock the
// data layer + WhatsApp so we can assert who gets paged and through which
// channel, without a DB or BSP.

const paymentFindUnique = vi.fn();
const userFindUnique = vi.fn();
const centerFindUnique = vi.fn();
const membershipFindMany = vi.fn();
const notificationCreate = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    payment: { findUnique: (a: unknown) => paymentFindUnique(a) },
    user: { findUnique: (a: unknown) => userFindUnique(a) },
    center: { findUnique: (a: unknown) => centerFindUnique(a) },
    centerMembership: { findMany: (a: unknown) => membershipFindMany(a) },
    notification: { create: (a: unknown) => notificationCreate(a) },
  },
}));

const getCachedPolicy = vi.fn();
vi.mock('@/lib/policy-cache', () => ({
  getCachedPolicy: (k: string) => getCachedPolicy(k),
}));

const sendWhatsAppText = vi.fn();
vi.mock('@/lib/whatsapp', () => ({
  sendWhatsAppText: (m: string, t: string) => sendWhatsAppText(m, t),
  sendWhatsAppNotification: vi.fn(),
}));

vi.mock('@/lib/time', () => ({ formatIST: vi.fn() }));
vi.mock('@/lib/constants', () => ({ MACHINES: {} }));

import { notifyAdminPaymentIssue } from '../notifications';

type CreateArgs = { data: { userId: string; title: string; message: string; type: string } };

beforeEach(() => {
  vi.clearAllMocks();
  notificationCreate.mockResolvedValue({ id: 'ntf_1' });
  getCachedPolicy.mockResolvedValue('true'); // WhatsApp enabled
  sendWhatsAppText.mockResolvedValue({ success: true, messageId: 'wamid.1' });
});

describe('notifyAdminPaymentIssue', () => {
  it('pages every active admin in-app + WhatsApp on a NEEDS_ATTENTION payment', async () => {
    paymentFindUnique.mockResolvedValue({ amount: 550, userId: 'u_payer', centerId: 'ctr_abca', razorpayPaymentId: 'pay_X' });
    userFindUnique.mockResolvedValue({ name: 'Omkar', mobileNumber: '9028633618' });
    centerFindUnique.mockResolvedValue({ name: 'ABCA' });
    membershipFindMany.mockResolvedValue([
      { user: { id: 'admin_1', name: 'Owner', mobileNumber: '9000000001' } },
      { user: { id: 'admin_2', name: 'Manager', mobileNumber: null } },
    ]);

    await notifyAdminPaymentIssue({ paymentId: 'pay_row_1', outcome: 'NEEDS_ATTENTION', reason: 'wallet refund failed' });

    // In-app to both admins.
    expect(notificationCreate).toHaveBeenCalledTimes(2);
    const ids = notificationCreate.mock.calls.map((c) => (c[0] as CreateArgs).data.userId).sort();
    expect(ids).toEqual(['admin_1', 'admin_2']);
    const first = (notificationCreate.mock.calls[0][0] as CreateArgs).data;
    expect(first.title).toBe('Payment needs manual action');
    expect(first.type).toBe('WARNING');
    expect(first.message).toContain('Omkar');
    expect(first.message).toContain('₹550');
    // WhatsApp only to the admin who has a mobile number.
    expect(sendWhatsAppText).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppText.mock.calls[0][0]).toBe('9000000001');
  });

  it('writes in-app but skips WhatsApp when notifications are disabled', async () => {
    getCachedPolicy.mockResolvedValue('false');
    paymentFindUnique.mockResolvedValue({ amount: 1200, userId: 'u', centerId: 'c', razorpayPaymentId: null });
    userFindUnique.mockResolvedValue({ name: 'Supratik', mobileNumber: '9940679099' });
    centerFindUnique.mockResolvedValue({ name: 'ABCA' });
    membershipFindMany.mockResolvedValue([{ user: { id: 'admin_1', name: 'Owner', mobileNumber: '9000000001' } }]);

    await notifyAdminPaymentIssue({ paymentId: 'p', outcome: 'REFUNDED', reason: 'slot already booked' });

    expect(notificationCreate).toHaveBeenCalledTimes(1);
    expect((notificationCreate.mock.calls[0][0] as CreateArgs).data.title).toBe('Payment auto-refunded');
    expect(sendWhatsAppText).not.toHaveBeenCalled();
  });

  it('never throws and writes nothing when the payment is missing', async () => {
    paymentFindUnique.mockResolvedValue(null);
    await expect(
      notifyAdminPaymentIssue({ paymentId: 'nope', outcome: 'REFUNDED', reason: 'x' }),
    ).resolves.toBeUndefined();
    expect(notificationCreate).not.toHaveBeenCalled();
  });
});
