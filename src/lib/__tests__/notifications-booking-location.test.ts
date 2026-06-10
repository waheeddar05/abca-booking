import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────
// Verifies the per-center "View Location" button wiring on the customer
// booking confirmation. notifyCustomerNewBooking → notifyBookingConfirmed
// chooses the WhatsApp template by env: the legacy `booking_detail` (no
// button) when WHATSAPP_BOOKING_TEMPLATE is unset, otherwise the named
// template PLUS a dynamic URL button whose suffix is the center slug.

const findManyMock = vi.fn();
const createMock = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: { findMany: (args: unknown) => findManyMock(args) },
    notification: { create: (args: unknown) => createMock(args) },
    // center.findUnique should NEVER be hit here: the resource path passes
    // the slug explicitly, so resolveCenterSlug returns without a DB call.
    center: { findUnique: vi.fn(() => { throw new Error('unexpected center lookup'); }) },
  },
}));

const getCachedPolicyMock = vi.fn();
vi.mock('@/lib/policy-cache', () => ({
  getCachedPolicy: (key: string) => getCachedPolicyMock(key),
}));

const sendWhatsAppNotificationMock = vi.fn();
vi.mock('@/lib/whatsapp', () => ({
  sendWhatsAppNotification: (...args: unknown[]) => sendWhatsAppNotificationMock(...args),
  sendWhatsAppText: vi.fn(),
}));

vi.mock('@/lib/constants', () => ({
  MACHINES: { GRAVITY: { shortName: 'Gravity' } },
}));

vi.mock('@/lib/time', () => ({
  formatIST: (_d: Date, fmt: string) => (fmt.includes('hh') ? '04:00 PM' : 'Wed, 03 Jun 2026'),
}));

import { notifyCustomerNewBooking } from '../notifications';

const baseStart = new Date('2026-06-03T10:30:00.000Z'); // 04:00 PM IST
const baseEnd = new Date('2026-06-03T11:00:00.000Z');

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bk_1',
    userId: 'user_1',
    playerName: 'Rahul',
    date: new Date('2026-06-03T00:00:00.000Z'),
    startTime: baseStart,
    endTime: baseEnd,
    category: 'MACHINE',
    machineId: null,
    pitchType: 'ASTRO',
    price: 500,
    status: 'BOOKED',
    paymentMethod: 'ONLINE',
    paymentStatus: 'PAID',
    kitRental: false,
    kitRentalCharge: null,
    user: { mobileNumber: '9876500000', mobileVerified: true },
    center: { name: 'Toplay Indoor', slug: 'toplay' },
    operator: { name: 'Op Sam', mobileNumber: '9876500002' },
    assignedCoach: null,
    assignedStaff: null,
    assignedMachine: { name: 'Yantra 1', machineType: { name: 'Yantra' } },
    resourceAssignments: [{ resource: { name: 'Indoor Net 2' } }],
    packageBooking: null,
    ...overrides,
  };
}

/** The components array passed to the WhatsApp send (body [+ button]). */
function components(): Array<{
  type: string;
  sub_type?: string;
  index?: string;
  parameters: Array<{ type: string; text: string }>;
}> {
  return sendWhatsAppNotificationMock.mock.calls[0][2];
}

const ENV_KEY = 'WHATSAPP_BOOKING_TEMPLATE';
const original = process.env[ENV_KEY];

beforeEach(() => {
  vi.clearAllMocks();
  getCachedPolicyMock.mockResolvedValue('true'); // WhatsApp enabled
  sendWhatsAppNotificationMock.mockResolvedValue({ success: true, messageId: 'wamid.1' });
  createMock.mockResolvedValue({ id: 'notif_1' });
  delete process.env[ENV_KEY];
});

afterEach(() => {
  if (original === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = original;
});

describe('booking confirmation — per-center location button', () => {
  it('uses booking_detail with no button when WHATSAPP_BOOKING_TEMPLATE is unset', async () => {
    findManyMock.mockResolvedValue([row()]);

    await notifyCustomerNewBooking(['bk_1']);

    const [, template] = sendWhatsAppNotificationMock.mock.calls[0];
    expect(template).toBe('booking_detail');

    const comps = components();
    expect(comps).toHaveLength(1); // body only — no button
    expect(comps[0].type).toBe('body');
    expect(comps[0].parameters).toHaveLength(7);
    expect(comps.some((c) => c.type === 'button')).toBe(false);
  });

  it('uses the configured template + a slug-suffixed URL button when set', async () => {
    process.env[ENV_KEY] = 'booking_detail_loc';
    findManyMock.mockResolvedValue([row()]);

    await notifyCustomerNewBooking(['bk_1']);

    const [, template] = sendWhatsAppNotificationMock.mock.calls[0];
    expect(template).toBe('booking_detail_loc');

    const comps = components();
    expect(comps).toHaveLength(2); // body + button
    expect(comps[0].type).toBe('body');
    expect(comps[0].parameters).toHaveLength(7); // body param count unchanged

    const button = comps.find((c) => c.type === 'button');
    expect(button).toBeDefined();
    expect(button!.sub_type).toBe('url');
    expect(button!.index).toBe('0');
    expect(button!.parameters).toEqual([{ type: 'text', text: 'toplay' }]);
  });

  it('falls back to the "default" slug when the center slug is missing', async () => {
    process.env[ENV_KEY] = 'booking_detail_loc';
    findManyMock.mockResolvedValue([row({ center: { name: 'Mystery Center', slug: undefined } })]);

    await notifyCustomerNewBooking(['bk_1']);

    const button = components().find((c) => c.type === 'button');
    expect(button!.parameters).toEqual([{ type: 'text', text: 'default' }]);
  });
});
