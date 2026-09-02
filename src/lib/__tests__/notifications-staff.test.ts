import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────
// Mock the data + delivery layers so we can assert *who* gets notified
// and *how*, without a real DB or WhatsApp provider.

const findManyMock = vi.fn();
const findUniqueMock = vi.fn();
const createMock = vi.fn();
const membershipFindFirstMock = vi.fn();
const membershipFindManyMock = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: {
      findMany: (args: unknown) => findManyMock(args),
      findUnique: (args: unknown) => findUniqueMock(args),
    },
    notification: {
      create: (args: unknown) => createMock(args),
    },
    centerMembership: {
      findFirst: (args: unknown) => membershipFindFirstMock(args),
      findMany: (args: unknown) => membershipFindManyMock(args),
    },
  },
}));

const getCachedPolicyMock = vi.fn();
vi.mock('@/lib/policy-cache', () => ({
  getCachedPolicy: (key: string) => getCachedPolicyMock(key),
}));

// Center-wide booking-notification config (BOOKING_NOTIFICATION_CONFIG).
// Defaults to "no role subscribers" here so these tests keep asserting the
// assigned-staff path in isolation; the role-subscriber behaviour has its
// own suite (notifications-role-subscribers.test.ts).
const getPolicyJsonMock = vi.fn();
vi.mock('@/lib/policy', () => ({
  getPolicyJson: (key: string, centerId: string | null, fallback: unknown) =>
    getPolicyJsonMock(key, centerId, fallback),
}));

const sendWhatsAppTextMock = vi.fn();
const sendWhatsAppNotificationMock = vi.fn();
vi.mock('@/lib/whatsapp', () => ({
  sendWhatsAppText: (mobile: string, text: string) => sendWhatsAppTextMock(mobile, text),
  sendWhatsAppNotification: (
    mobile: string,
    template: string,
    components: unknown,
    language?: string,
  ) => sendWhatsAppNotificationMock(mobile, template, components, language),
}));

// MACHINES is only used for legacy fallback labels.
vi.mock('@/lib/constants', () => ({
  MACHINES: { GRAVITY: { shortName: 'Gravity' } },
}));

vi.mock('@/lib/time', () => ({
  formatIST: (_d: Date, fmt: string) => (fmt.includes('hh') ? '04:00 PM' : 'Wed, 03 Jun 2026'),
}));

import {
  notifyAssignedStaffNewBooking,
  notifyAssignedStaffBookingCancelled,
} from '../notifications';

const baseStart = new Date('2026-06-03T10:30:00.000Z'); // 04:00 PM IST
const baseEnd = new Date('2026-06-03T11:00:00.000Z'); // 30 min later

function bookingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bk_1',
    playerName: 'Rahul',
    date: new Date('2026-06-03T00:00:00.000Z'),
    startTime: baseStart,
    endTime: baseEnd,
    category: 'COACHING',
    machineId: null,
    pitchType: null,
    price: 500,
    paymentMethod: 'ONLINE',
    paymentStatus: 'PAID',
    centerId: 'ctr_1',
    cancelledBy: null,
    cancellationReason: null,
    center: { name: 'Toplay Indoor' },
    user: { mobileNumber: '9990001111' },
    operator: null,
    assignedCoach: { id: 'coach_1', name: 'Coach Anil', mobileNumber: '9876500001' },
    assignedStaff: null,
    assignedMachine: null,
    resourceAssignments: [{ resource: { name: 'Indoor Net 2' } }],
    packageBooking: null,
    ...overrides,
  };
}

/** Flatten the body parameters of the Nth sendWhatsAppNotification call. */
function templateParams(callIndex = 0): string[] {
  const call = sendWhatsAppNotificationMock.mock.calls[callIndex];
  const components = call?.[2] as { parameters?: { text?: string }[] }[] | undefined;
  return (components?.[0]?.parameters ?? []).map((p) => p.text ?? '');
}

beforeEach(() => {
  vi.clearAllMocks();
  getCachedPolicyMock.mockResolvedValue('true'); // WhatsApp enabled
  // Default: the approved template delivers (the new primary path). Staff
  // notifications go through sendWhatsAppNotification; the free-form text
  // is only a fallback.
  sendWhatsAppNotificationMock.mockResolvedValue({ success: true, messageId: 'wamid.tmpl' });
  sendWhatsAppTextMock.mockResolvedValue({ success: true, messageId: 'wamid.text' });
  createMock.mockResolvedValue({ id: 'notif_1' });
  // Default: no ground staff configured at the center. Tests that
  // exercise the ground-staff path override this per-case.
  membershipFindFirstMock.mockResolvedValue(null);
  // Default: every role switched off, so only assigned staff are paged.
  getPolicyJsonMock.mockResolvedValue({
    roles: {
      ADMIN: false,
      MODERATOR: false,
      OPERATOR: false,
      COACH: false,
      SIDEARM_SPECIALIST: false,
      GROUND_STAFF: false,
    },
  });
  membershipFindManyMock.mockResolvedValue([]);
  delete process.env.WHATSAPP_STAFF_BOOKING_TEMPLATE;
  delete process.env.WHATSAPP_STAFF_CANCEL_TEMPLATE;
  delete process.env.WHATSAPP_BOOKING_DETAIL_LOCATION_ENABLED;
});

afterEach(() => {
  delete process.env.WHATSAPP_STAFF_BOOKING_TEMPLATE;
  delete process.env.WHATSAPP_STAFF_CANCEL_TEMPLATE;
  delete process.env.WHATSAPP_BOOKING_DETAIL_LOCATION_ENABLED;
});

describe('notifyAssignedStaffNewBooking', () => {
  it('notifies every distinct assigned staff member via an approved template (operator + coach + specialist)', async () => {
    findManyMock.mockResolvedValue([
      bookingRow({
        category: 'MACHINE',
        operator: { id: 'op_1', name: 'Op Sam', mobileNumber: '9876500002' },
        assignedCoach: { id: 'coach_1', name: 'Coach Anil', mobileNumber: '9876500001' },
        assignedStaff: { id: 'staff_1', name: 'Spec Vik', mobileNumber: '9876500003' },
        assignedMachine: { name: 'Yantra 1', machineType: { name: 'Yantra' } },
      }),
    ]);

    await notifyAssignedStaffNewBooking(['bk_1']);

    // 3 approved-template WhatsApp messages (one per staff member with a mobile)
    expect(sendWhatsAppNotificationMock).toHaveBeenCalledTimes(3);
    const recipients = sendWhatsAppNotificationMock.mock.calls.map((c) => c[0]).sort();
    expect(recipients).toEqual(['9876500001', '9876500002', '9876500003']);
    // Template succeeded → no free-form fallback
    expect(sendWhatsAppTextMock).not.toHaveBeenCalled();
    // 3 in-app notifications too
    expect(createMock).toHaveBeenCalledTimes(3);
  });

  it('reuses the approved booking_detail template with the booking details', async () => {
    findManyMock.mockResolvedValue([bookingRow()]);

    await notifyAssignedStaffNewBooking(['bk_1']);

    // Default (no dedicated template): reuse the approved customer template.
    const [, templateName] = sendWhatsAppNotificationMock.mock.calls[0];
    expect(templateName).toBe('booking_detail');
    const params = templateParams();
    expect(params[0]).toContain('Toplay Indoor'); // center name folded into {{1}}
    expect(params).toContain('Personal Coaching'); // booking type
    expect(params).toContain('₹500'); // price
    expect(params).toContain('Coach Anil'); // on-ground contact (coach for COACHING)
    // Who booked + how to reach them is folded into the facility param so
    // the staff alert identifies the customer (the reused customer template
    // has no dedicated slot for it).
    expect(params.some((p) => p.includes('Indoor Net 2'))).toBe(true); // facility / resource
    expect(params.some((p) => p.includes('Booked by Rahul') && p.includes('9990001111'))).toBe(true);

    // The customer name + phone are on the always-on in-app notification too.
    const inApp = createMock.mock.calls[0][0] as { data: { message: string } };
    expect(inApp.data.message).toContain('Rahul');
    expect(inApp.data.message).toContain('9990001111');
    expect(inApp.data.message).toContain('Indoor Net 2');
  });

  it('appends the booking center map link as {{8}} when the location param is enabled', async () => {
    process.env.WHATSAPP_BOOKING_DETAIL_LOCATION_ENABLED = 'true';
    findManyMock.mockResolvedValue([
      bookingRow({ center: { name: 'Toplay Indoor', mapUrl: 'https://maps.example/toplay' } }),
    ]);

    await notifyAssignedStaffNewBooking(['bk_1']);

    const params = templateParams();
    expect(params).toHaveLength(8);
    expect(params[7]).toBe('https://maps.example/toplay'); // the booking center's OWN map
  });

  it('reflects multi-slot bookings in the template time parameter', async () => {
    findManyMock.mockResolvedValue([
      bookingRow(),
      bookingRow({ id: 'bk_2', startTime: baseEnd, endTime: new Date('2026-06-03T11:30:00.000Z') }),
    ]);

    await notifyAssignedStaffNewBooking(['bk_1', 'bk_2']);

    const params = templateParams();
    // {{2}} is the time window; multi-slot appends a "(N slots)" suffix.
    expect(params[1]).toContain('(2 slots)');
  });

  it('falls back to free-form text when the approved template send fails', async () => {
    sendWhatsAppNotificationMock.mockResolvedValue({ success: false, error: 'template rejected' });
    findManyMock.mockResolvedValue([bookingRow()]);

    await notifyAssignedStaffNewBooking(['bk_1']);

    expect(sendWhatsAppNotificationMock).toHaveBeenCalledTimes(1);
    // Template failed → free-form text fallback kicks in
    expect(sendWhatsAppTextMock).toHaveBeenCalledTimes(1);
    const [, text] = sendWhatsAppTextMock.mock.calls[0];
    expect(text).toContain('New Booking');
    expect(text).toContain('Rahul'); // customer
    expect(text).toContain('Booking ID');
    expect(text).toContain('bk_1');
  });

  it('does NOT send the text fallback when the WhatsApp provider is unconfigured', async () => {
    // sendWhatsAppNotification returns null when no provider is configured;
    // the text fallback would be unconfigured too, so it must be skipped.
    sendWhatsAppNotificationMock.mockResolvedValue(null);
    findManyMock.mockResolvedValue([bookingRow()]);

    await notifyAssignedStaffNewBooking(['bk_1']);

    expect(sendWhatsAppNotificationMock).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppTextMock).not.toHaveBeenCalled();
    expect(createMock).toHaveBeenCalledTimes(1); // in-app still created
  });

  it('uses the dedicated staff template when WHATSAPP_STAFF_BOOKING_TEMPLATE is set', async () => {
    process.env.WHATSAPP_STAFF_BOOKING_TEMPLATE = 'staff_booking_alert';
    findManyMock.mockResolvedValue([
      bookingRow({
        category: 'SIDEARM',
        assignedCoach: null,
        assignedStaff: { id: 'staff_1', name: 'Spec Vik', mobileNumber: '9876500003' },
      }),
    ]);

    await notifyAssignedStaffNewBooking(['bk_1']);

    const [mobile, templateName] = sendWhatsAppNotificationMock.mock.calls[0];
    expect(mobile).toBe('9876500003');
    expect(templateName).toBe('staff_booking_alert');
    const params = templateParams();
    // Dedicated contract: {{1}} center, {{2}} role, {{3}} customer, {{4}} customer phone …
    expect(params[0]).toBe('Toplay Indoor');
    expect(params[1]).toBe('Trainer Specialist'); // SIDEARM_SPECIALIST role label
    expect(params[2]).toBe('Rahul'); // customer name
    expect(params[3]).toBe('9990001111'); // customer phone
    expect(params).toContain('Sidearm Session'); // booking type
    expect(params).toContain('Indoor Net 2'); // facility
  });

  it('skips WhatsApp for staff without a mobile number but still records in-app', async () => {
    findManyMock.mockResolvedValue([
      bookingRow({ assignedCoach: { id: 'coach_1', name: 'Coach Anil', mobileNumber: null } }),
    ]);

    await notifyAssignedStaffNewBooking(['bk_1']);

    expect(sendWhatsAppNotificationMock).not.toHaveBeenCalled();
    expect(sendWhatsAppTextMock).not.toHaveBeenCalled();
    expect(createMock).toHaveBeenCalledTimes(1); // in-app still created
  });

  it('does not send WhatsApp when the feature flag is off', async () => {
    getCachedPolicyMock.mockResolvedValue('false');
    findManyMock.mockResolvedValue([bookingRow()]);

    await notifyAssignedStaffNewBooking(['bk_1']);

    expect(sendWhatsAppNotificationMock).not.toHaveBeenCalled();
    expect(sendWhatsAppTextMock).not.toHaveBeenCalled();
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('does nothing when no staff is assigned', async () => {
    findManyMock.mockResolvedValue([
      bookingRow({ operator: null, assignedCoach: null, assignedStaff: null }),
    ]);

    await notifyAssignedStaffNewBooking(['bk_1']);

    expect(sendWhatsAppNotificationMock).not.toHaveBeenCalled();
    expect(sendWhatsAppTextMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('dedupes a staff member assigned in two roles across slots', async () => {
    findManyMock.mockResolvedValue([
      bookingRow({ assignedCoach: { id: 'coach_1', name: 'Coach Anil', mobileNumber: '9876500001' } }),
      bookingRow({ id: 'bk_2', assignedCoach: { id: 'coach_1', name: 'Coach Anil', mobileNumber: '9876500001' } }),
    ]);

    await notifyAssignedStaffNewBooking(['bk_1', 'bk_2']);

    expect(sendWhatsAppNotificationMock).toHaveBeenCalledTimes(1);
  });

  it('notifies the center ground staff for a Cricket Net booking with no assigned staff', async () => {
    findManyMock.mockResolvedValue([
      bookingRow({ category: 'NET', operator: null, assignedCoach: null, assignedStaff: null }),
    ]);
    membershipFindFirstMock.mockResolvedValue({
      user: { id: 'ground_1', name: 'Ground Ravi', mobileNumber: '9876500009' },
    });

    await notifyAssignedStaffNewBooking(['bk_1']);

    expect(membershipFindFirstMock).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppNotificationMock).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppNotificationMock.mock.calls[0][0]).toBe('9876500009');
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('pages the booking-pinned ground staff for a Cricket Net booking and skips the center default', async () => {
    findManyMock.mockResolvedValue([
      bookingRow({
        category: 'NET',
        assignedCoach: null,
        assignedGroundStaff: { id: 'ground_2', name: 'Ground Gita', mobileNumber: '9876500010' },
      }),
    ]);
    // Center default exists but must NOT be paged when the booking pins
    // its own ground-staff member.
    membershipFindFirstMock.mockResolvedValue({
      user: { id: 'ground_1', name: 'Ground Ravi', mobileNumber: '9876500009' },
    });

    await notifyAssignedStaffNewBooking(['bk_1']);

    expect(membershipFindFirstMock).not.toHaveBeenCalled();
    expect(sendWhatsAppNotificationMock).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppNotificationMock.mock.calls[0][0]).toBe('9876500010');
    // The ground-staff member is the on-ground contact ({{6}}) for a Net
    // booking — not "To be assigned".
    expect(templateParams()).toContain('Ground Gita');
  });

  it('notifies both the specialist and the ground staff for a Sidearm booking', async () => {
    findManyMock.mockResolvedValue([
      bookingRow({
        category: 'SIDEARM',
        assignedCoach: null,
        assignedStaff: { id: 'staff_1', name: 'Spec Vik', mobileNumber: '9876500003' },
      }),
    ]);
    membershipFindFirstMock.mockResolvedValue({
      user: { id: 'ground_1', name: 'Ground Ravi', mobileNumber: '9876500009' },
    });

    await notifyAssignedStaffNewBooking(['bk_1']);

    const recipients = sendWhatsAppNotificationMock.mock.calls.map((c) => c[0]).sort();
    expect(recipients).toEqual(['9876500003', '9876500009']);
  });

  it('does not double-notify a ground-staff member who is also the assigned coach', async () => {
    findManyMock.mockResolvedValue([
      bookingRow({ assignedCoach: { id: 'dual_1', name: 'Dual Dev', mobileNumber: '9876500011' } }),
    ]);
    membershipFindFirstMock.mockResolvedValue({
      user: { id: 'dual_1', name: 'Dual Dev', mobileNumber: '9876500011' },
    });

    await notifyAssignedStaffNewBooking(['bk_1']);

    expect(sendWhatsAppNotificationMock).toHaveBeenCalledTimes(1);
  });

  it('does not look up ground staff for a Bowling Machine booking', async () => {
    findManyMock.mockResolvedValue([
      bookingRow({
        category: 'MACHINE',
        operator: { id: 'op_1', name: 'Op Sam', mobileNumber: '9876500002' },
        assignedCoach: null,
      }),
    ]);

    await notifyAssignedStaffNewBooking(['bk_1']);

    expect(membershipFindFirstMock).not.toHaveBeenCalled();
    expect(sendWhatsAppNotificationMock).toHaveBeenCalledTimes(1);
  });

  it('never throws even if the data lookup fails', async () => {
    findManyMock.mockRejectedValue(new Error('db down'));
    await expect(notifyAssignedStaffNewBooking(['bk_1'])).resolves.toBeUndefined();
  });
});

describe('notifyAssignedStaffBookingCancelled', () => {
  it('notifies assigned staff via an approved template (delivers outside the 24h window)', async () => {
    findUniqueMock.mockResolvedValue(
      bookingRow({
        category: 'SIDEARM',
        assignedCoach: null,
        assignedStaff: { id: 'staff_1', name: 'Spec Vik', mobileNumber: '9876500003' },
      }),
    );

    await notifyAssignedStaffBookingCancelled('bk_1', { cancelledBy: 'Admin', reason: 'Rain' });

    // The fix: cancellations now go through an approved template too (they
    // used to be free-form-only, so they were silently dropped for staff
    // outside WhatsApp's 24h window). Default reuses the approved customer
    // booking_cancelled template (1 param) — no BSP changes needed.
    expect(sendWhatsAppNotificationMock).toHaveBeenCalledTimes(1);
    const [mobile, templateName] = sendWhatsAppNotificationMock.mock.calls[0];
    expect(mobile).toBe('9876500003');
    expect(templateName).toBe('booking_cancelled');
    const detail = templateParams()[0];
    expect(detail).toContain('Toplay Indoor');
    expect(detail).toContain('Rahul');
    expect(detail).toContain('Admin'); // cancelled by
    expect(detail).toContain('Rain'); // reason
    // Template delivered → no free-form fallback.
    expect(sendWhatsAppTextMock).not.toHaveBeenCalled();
    // In-app notification always created, with the booking details.
    expect(createMock).toHaveBeenCalledTimes(1);
    const inApp = createMock.mock.calls[0][0] as { data: { message: string } };
    expect(inApp.data.message).toContain('Rahul');
    expect(inApp.data.message).toContain('Indoor Net 2');
  });

  it('falls back to free-form text when the approved template send fails', async () => {
    sendWhatsAppNotificationMock.mockResolvedValue({ success: false, error: 'template rejected' });
    findUniqueMock.mockResolvedValue(
      bookingRow({
        category: 'SIDEARM',
        assignedCoach: null,
        assignedStaff: { id: 'staff_1', name: 'Spec Vik', mobileNumber: '9876500003' },
      }),
    );

    await notifyAssignedStaffBookingCancelled('bk_1', { cancelledBy: 'Admin', reason: 'Rain' });

    expect(sendWhatsAppNotificationMock).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppTextMock).toHaveBeenCalledTimes(1);
    const joined = sendWhatsAppTextMock.mock.calls.map((c) => c[1]).join('\n');
    expect(joined).toContain('Cancelled');
    expect(joined).toContain('Rahul');
    expect(joined).toContain('Admin'); // cancelled by
    expect(joined).toContain('Rain'); // reason
    expect(joined).toContain('Booking ID');
    expect(joined).toContain('bk_1');
  });

  it('uses the dedicated staff-cancel template when WHATSAPP_STAFF_CANCEL_TEMPLATE is set', async () => {
    process.env.WHATSAPP_STAFF_CANCEL_TEMPLATE = 'staff_cancel_alert';
    findUniqueMock.mockResolvedValue(
      bookingRow({
        category: 'SIDEARM',
        assignedCoach: null,
        assignedStaff: { id: 'staff_1', name: 'Spec Vik', mobileNumber: '9876500003' },
      }),
    );

    await notifyAssignedStaffBookingCancelled('bk_1', { cancelledBy: 'Admin', reason: 'Rain' });

    const [mobile, templateName] = sendWhatsAppNotificationMock.mock.calls[0];
    expect(mobile).toBe('9876500003');
    expect(templateName).toBe('staff_cancel_alert');
    const params = templateParams();
    // Contract: {{1}} center, {{2}} role, {{3}} customer, {{4}} phone …
    expect(params[0]).toBe('Toplay Indoor');
    expect(params[1]).toBe('Trainer Specialist');
    expect(params[2]).toBe('Rahul');
    expect(params).toContain('Admin'); // cancelled by ({{8}})
  });

  it('notifies the assigned ground staff when a Cricket Net booking is cancelled', async () => {
    findUniqueMock.mockResolvedValue(
      bookingRow({
        category: 'NET',
        assignedCoach: null,
        assignedGroundStaff: { id: 'ground_2', name: 'Ground Gita', mobileNumber: '9876500010' },
      }),
    );

    await notifyAssignedStaffBookingCancelled('bk_1', { cancelledBy: 'Admin' });

    expect(sendWhatsAppNotificationMock).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppNotificationMock.mock.calls[0][0]).toBe('9876500010');
    const detail = templateParams()[0];
    expect(detail).toContain('Ground Staff session cancelled');
  });

  it('does nothing for a booking with no assigned staff', async () => {
    findUniqueMock.mockResolvedValue(
      bookingRow({ assignedCoach: null, assignedStaff: null, operator: null }),
    );

    await notifyAssignedStaffBookingCancelled('bk_1');

    expect(sendWhatsAppNotificationMock).not.toHaveBeenCalled();
    expect(sendWhatsAppTextMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('never throws when the booking is missing', async () => {
    findUniqueMock.mockResolvedValue(null);
    await expect(notifyAssignedStaffBookingCancelled('bk_x')).resolves.toBeUndefined();
  });
});
