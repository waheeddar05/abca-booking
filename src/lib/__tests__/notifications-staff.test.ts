import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────
// Mock the data + delivery layers so we can assert *who* gets notified
// and *how*, without a real DB or WhatsApp provider.

const findManyMock = vi.fn();
const findUniqueMock = vi.fn();
const createMock = vi.fn();
const membershipFindFirstMock = vi.fn();

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
    },
  },
}));

const getCachedPolicyMock = vi.fn();
vi.mock('@/lib/policy-cache', () => ({
  getCachedPolicy: (key: string) => getCachedPolicyMock(key),
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
  delete process.env.WHATSAPP_STAFF_BOOKING_TEMPLATE;
});

afterEach(() => {
  delete process.env.WHATSAPP_STAFF_BOOKING_TEMPLATE;
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
    expect(params).toContain('Indoor Net 2'); // facility / resource
    expect(params).toContain('₹500'); // price
    expect(params).toContain('Coach Anil'); // on-ground contact (coach for COACHING)

    // The customer name still rides on the always-on in-app notification.
    const inApp = createMock.mock.calls[0][0] as { data: { message: string } };
    expect(inApp.data.message).toContain('Rahul');
    expect(inApp.data.message).toContain('Indoor Net 2');
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
  it('notifies assigned staff with cancellation details (free-form text)', async () => {
    findUniqueMock.mockResolvedValue(
      bookingRow({ assignedStaff: { id: 'staff_1', name: 'Spec Vik', mobileNumber: '9876500003' } }),
    );

    await notifyAssignedStaffBookingCancelled('bk_1', { cancelledBy: 'Admin', reason: 'Rain' });

    // Cancellations stay on free-form text (no approved staff-cancellation
    // template). The booking-creation alert is the one that moved to a
    // template; cancellations are unchanged.
    expect(sendWhatsAppTextMock).toHaveBeenCalled();
    const texts = sendWhatsAppTextMock.mock.calls.map((c) => c[1]);
    const joined = texts.join('\n');
    expect(joined).toContain('Cancelled');
    expect(joined).toContain('Toplay Indoor');
    expect(joined).toContain('Rahul');
    expect(joined).toContain('Indoor Net 2');
    expect(joined).toContain('Admin'); // cancelled by
    expect(joined).toContain('Rain'); // reason
    expect(joined).toContain('Booking ID'); // reference label
    expect(joined).toContain('bk_1'); // the booking id itself
  });

  it('does nothing for a booking with no assigned staff', async () => {
    findUniqueMock.mockResolvedValue(
      bookingRow({ assignedCoach: null, assignedStaff: null, operator: null }),
    );

    await notifyAssignedStaffBookingCancelled('bk_1');

    expect(sendWhatsAppTextMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('never throws when the booking is missing', async () => {
    findUniqueMock.mockResolvedValue(null);
    await expect(notifyAssignedStaffBookingCancelled('bk_x')).resolves.toBeUndefined();
  });
});
