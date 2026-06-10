import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────
// notifyCustomerNewBooking loads the created booking(s), derives
// category-appropriate fields, and delegates to notifyBookingConfirmed
// (in-app via notification.create + WhatsApp via the booking_detail
// template). We mock the data + delivery layers to assert WHAT the
// customer is told for each booking category.

const findManyMock = vi.fn();
const createMock = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: { findMany: (args: unknown) => findManyMock(args) },
    notification: { create: (args: unknown) => createMock(args) },
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
const baseEnd = new Date('2026-06-03T11:00:00.000Z'); // 30 min later

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bk_1',
    userId: 'user_1',
    playerName: 'Rahul',
    date: new Date('2026-06-03T00:00:00.000Z'),
    startTime: baseStart,
    endTime: baseEnd,
    category: 'COACHING',
    machineId: null,
    pitchType: null,
    price: 500,
    status: 'BOOKED',
    paymentMethod: 'ONLINE',
    paymentStatus: 'PAID',
    kitRental: false,
    kitRentalCharge: null,
    user: { mobileNumber: '9876500000', mobileVerified: true },
    center: { name: 'Toplay Indoor' },
    operator: null,
    assignedCoach: { name: 'Coach Anil', mobileNumber: '9876500001' },
    assignedStaff: null,
    assignedMachine: null,
    resourceAssignments: [{ resource: { name: 'Indoor Net 2' } }],
    packageBooking: null,
    ...overrides,
  };
}

/** Pull the body parameter texts out of the WhatsApp template call. */
function templateParams(): string[] {
  const components = sendWhatsAppNotificationMock.mock.calls[0][2] as Array<{
    parameters: Array<{ text: string }>;
  }>;
  return components[0].parameters.map((p) => p.text);
}

beforeEach(() => {
  vi.clearAllMocks();
  getCachedPolicyMock.mockResolvedValue('true'); // WhatsApp enabled
  sendWhatsAppNotificationMock.mockResolvedValue({ success: true, messageId: 'wamid.1' });
  createMock.mockResolvedValue({ id: 'notif_1' });
  delete process.env.WHATSAPP_BOOKING_DETAIL_LOCATION_ENABLED;
});

describe('notifyCustomerNewBooking', () => {
  it('sends an in-app + WhatsApp confirmation for a coaching booking', async () => {
    findManyMock.mockResolvedValue([row()]);

    await notifyCustomerNewBooking(['bk_1']);

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppNotificationMock).toHaveBeenCalledTimes(1);
    const [mobile, template] = sendWhatsAppNotificationMock.mock.calls[0];
    expect(mobile).toBe('9876500000');
    expect(template).toBe('booking_detail');
    // Center name leads the {{1}} param (embedded into the date line) so
    // the recipient can tell which center the booking is at, at a glance —
    // without changing the approved BSP template's parameter count.
    expect(templateParams()[0]).toContain('Toplay Indoor');
    // Headline ({{3}}) reads as the category for non-machine bookings.
    expect(templateParams()).toContain('Personal Coaching');
  });

  it('uses the machine name + pitch for a bowling-machine booking', async () => {
    findManyMock.mockResolvedValue([
      row({
        category: 'MACHINE',
        assignedMachine: { name: 'Yantra 1', machineType: { name: 'Yantra' } },
        operator: { name: 'Op Sam', mobileNumber: '9876500002' },
        assignedCoach: null,
        pitchType: 'ASTRO',
      }),
    ]);

    await notifyCustomerNewBooking(['bk_1']);

    const params = templateParams();
    expect(params).toContain('Yantra 1');
    expect(params).toContain('Astro Turf');
    expect(params).toContain('Op Sam'); // operator surfaced as contact
  });

  it('labels Full Indoor Court bookings correctly', async () => {
    findManyMock.mockResolvedValue([row({ category: 'FULL_COURT', assignedCoach: null })]);

    await notifyCustomerNewBooking(['bk_1']);

    expect(templateParams()).toContain('Full Indoor Court');
  });

  it('shares the assigned ground staff as the contact for a Cricket Net booking', async () => {
    findManyMock.mockResolvedValue([
      row({
        category: 'NET',
        assignedCoach: null,
        pitchType: 'ASTRO',
        assignedGroundStaff: { name: 'Ground Ravi', mobileNumber: '9876500009' },
      }),
    ]);

    await notifyCustomerNewBooking(['bk_1']);

    const params = templateParams();
    expect(params).toContain('Cricket Net'); // category headline ({{3}})
    expect(params).toContain('Ground Ravi'); // ground staff as on-ground contact ({{6}})
    expect(params).toContain('9876500009'); // …with their phone ({{7}})
    // The in-app alert labels them Ground Staff — never "Operator".
    const inApp = createMock.mock.calls[0][0] as { data: { message: string } };
    expect(inApp.data.message).toContain('Ground Staff: Ground Ravi');
    expect(inApp.data.message).not.toContain('Operator:');
  });

  it('skips WhatsApp when the mobile is unverified but still records in-app', async () => {
    findManyMock.mockResolvedValue([
      row({ user: { mobileNumber: '9876500000', mobileVerified: false } }),
    ]);

    await notifyCustomerNewBooking(['bk_1']);

    expect(sendWhatsAppNotificationMock).not.toHaveBeenCalled();
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('marks a package redemption as a package session', async () => {
    findManyMock.mockResolvedValue([row({ packageBooking: { id: 'pb_1' }, price: 0 })]);

    await notifyCustomerNewBooking(['bk_1']);

    expect(templateParams()).toContain('Package session');
  });

  it('flags a cash booking as pay-at-center', async () => {
    findManyMock.mockResolvedValue([
      row({ paymentMethod: 'CASH', paymentStatus: 'PENDING' }),
    ]);

    await notifyCustomerNewBooking(['bk_1']);

    expect(templateParams()).toContain('₹500 (Pay at center)');
  });

  it('aggregates price and slot count across multiple slots', async () => {
    findManyMock.mockResolvedValue([
      row({ id: 'bk_1', price: 500 }),
      row({
        id: 'bk_2',
        price: 500,
        startTime: baseEnd,
        endTime: new Date('2026-06-03T11:30:00.000Z'),
      }),
    ]);

    await notifyCustomerNewBooking(['bk_1', 'bk_2']);

    const params = templateParams();
    expect(params).toContain('₹1000');
    expect(params.some((t) => t.includes('2 slots'))).toBe(true);
  });

  it('does nothing when every row is cancelled', async () => {
    findManyMock.mockResolvedValue([row({ status: 'CANCELLED' })]);

    await notifyCustomerNewBooking(['bk_1']);

    expect(createMock).not.toHaveBeenCalled();
    expect(sendWhatsAppNotificationMock).not.toHaveBeenCalled();
  });

  it('does nothing for a walk-in booking with no user account', async () => {
    findManyMock.mockResolvedValue([row({ userId: null })]);

    await notifyCustomerNewBooking(['bk_1']);

    expect(createMock).not.toHaveBeenCalled();
  });

  it('sends the legacy 7 params (no map link) by default', async () => {
    findManyMock.mockResolvedValue([
      row({ center: { name: 'Toplay Indoor', mapUrl: 'https://maps.example/toplay' } }),
    ]);

    await notifyCustomerNewBooking(['bk_1']);

    // Flag off → the template still expects 7 params; sending an 8th would
    // make Meta reject the message, so the center map link is NOT appended.
    expect(templateParams()).toHaveLength(7);
  });

  it('appends the center map link as {{8}} when the location param is enabled', async () => {
    process.env.WHATSAPP_BOOKING_DETAIL_LOCATION_ENABLED = 'true';
    findManyMock.mockResolvedValue([
      row({ center: { name: 'Toplay Indoor', mapUrl: 'https://maps.example/toplay' } }),
    ]);

    await notifyCustomerNewBooking(['bk_1']);

    const params = templateParams();
    expect(params).toHaveLength(8);
    expect(params[7]).toBe('https://maps.example/toplay'); // the booking center's OWN map, not ABCA's
  });

  it('never throws if the lookup fails', async () => {
    findManyMock.mockRejectedValue(new Error('db down'));
    await expect(notifyCustomerNewBooking(['bk_1'])).resolves.toBeUndefined();
  });
});
