import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────
// Center-wide booking notifications: everyone holding a role the center
// switched on in BOOKING_NOTIFICATION_CONFIG is told about every booking,
// on top of the customer and the staff actually assigned to it. These
// tests assert *who* is paged, under *which* wording, and that nobody is
// paged twice — without a real DB or WhatsApp provider.

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
import { BOOKING_NOTIFICATION_POLICY_KEY } from '../booking-notifications';

const baseStart = new Date('2026-06-03T10:30:00.000Z'); // 04:00 PM IST
const baseEnd = new Date('2026-06-03T11:00:00.000Z');

function bookingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bk_1',
    userId: 'customer_1',
    playerName: 'Rahul',
    date: new Date('2026-06-03T00:00:00.000Z'),
    startTime: baseStart,
    endTime: baseEnd,
    category: 'MACHINE',
    machineId: null,
    pitchType: 'ASTRO',
    ballType: 'LEATHER',
    operationMode: 'SELF_OPERATE',
    price: 500,
    paymentMethod: 'ONLINE',
    paymentStatus: 'PAID',
    kitRental: false,
    kitRentalCharge: null,
    centerId: 'ctr_1',
    cancelledBy: null,
    cancellationReason: null,
    center: { name: 'Toplay Indoor', mapUrl: null, slug: 'toplay' },
    user: { mobileNumber: '9990001111' },
    operator: null,
    assignedCoach: null,
    assignedStaff: null,
    assignedGroundStaff: null,
    assignedMachine: { name: 'Yantra 1', machineType: { name: 'Yantra' } },
    resourceAssignments: [{ resource: { name: 'Indoor Net 2' } }],
    packageBooking: null,
    ...overrides,
  };
}

/** A CenterMembership row in the shape loadRoleSubscribers selects. */
function membership(role: string, user: { id: string; name: string | null; mobileNumber: string | null }) {
  return { role, user };
}

/** Every in-app notification created, as {userId, title}. */
function inAppAlerts(): Array<{ userId: string; title: string; message: string }> {
  return createMock.mock.calls.map((c) => {
    const { userId, title, message } = (c[0] as { data: { userId: string; title: string; message: string } }).data;
    return { userId, title, message };
  });
}

/** Roles config helper — everything off except the named roles. */
function rolesOn(...roles: string[]) {
  return {
    roles: Object.fromEntries(
      ['ADMIN', 'MODERATOR', 'OPERATOR', 'COACH', 'SIDEARM_SPECIALIST', 'GROUND_STAFF'].map((r) => [
        r,
        roles.includes(r),
      ]),
    ),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getCachedPolicyMock.mockResolvedValue('true'); // WhatsApp enabled
  sendWhatsAppNotificationMock.mockResolvedValue({ success: true, messageId: 'wamid.tmpl' });
  sendWhatsAppTextMock.mockResolvedValue({ success: true, messageId: 'wamid.text' });
  createMock.mockResolvedValue({ id: 'notif_1' });
  membershipFindFirstMock.mockResolvedValue(null); // no center default ground staff
  membershipFindManyMock.mockResolvedValue([]);
  // Shipped default: moderators on, everyone else off, both events on.
  getPolicyJsonMock.mockResolvedValue(null);
  delete process.env.WHATSAPP_STAFF_BOOKING_TEMPLATE;
  delete process.env.WHATSAPP_STAFF_CANCEL_TEMPLATE;
});

afterEach(() => {
  delete process.env.WHATSAPP_STAFF_BOOKING_TEMPLATE;
  delete process.env.WHATSAPP_STAFF_CANCEL_TEMPLATE;
});

describe('role subscribers — new bookings', () => {
  it('notifies the center moderator by default, even with no assigned staff', async () => {
    findManyMock.mockResolvedValue([bookingRow()]);
    membershipFindManyMock.mockResolvedValue([
      membership('MODERATOR', { id: 'mod_1', name: 'Mod Priya', mobileNumber: '9876500010' }),
    ]);

    await notifyAssignedStaffNewBooking(['bk_1']);

    // The policy is read for THIS center.
    expect(getPolicyJsonMock).toHaveBeenCalledWith(BOOKING_NOTIFICATION_POLICY_KEY, 'ctr_1', null);
    // Only active MODERATOR memberships at this center are looked up.
    const where = (membershipFindManyMock.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(where).toEqual({ centerId: 'ctr_1', role: { in: ['MODERATOR'] }, isActive: true });

    expect(inAppAlerts()).toEqual([
      expect.objectContaining({ userId: 'mod_1', title: 'New Booking' }),
    ]);
    expect(sendWhatsAppNotificationMock).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppNotificationMock.mock.calls[0][0]).toBe('9876500010');
  });

  it('does not page anyone when every role is switched off', async () => {
    findManyMock.mockResolvedValue([bookingRow()]);
    getPolicyJsonMock.mockResolvedValue(rolesOn());

    await notifyAssignedStaffNewBooking(['bk_1']);

    // No roles enabled → no membership lookup at all, no alerts.
    expect(membershipFindManyMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
    expect(sendWhatsAppNotificationMock).not.toHaveBeenCalled();
  });

  it('notifies every enabled role — admin, moderator and any other', async () => {
    findManyMock.mockResolvedValue([bookingRow()]);
    getPolicyJsonMock.mockResolvedValue(rolesOn('ADMIN', 'MODERATOR', 'OPERATOR'));
    membershipFindManyMock.mockResolvedValue([
      membership('ADMIN', { id: 'adm_1', name: 'Admin Zoe', mobileNumber: '9876500011' }),
      membership('MODERATOR', { id: 'mod_1', name: 'Mod Priya', mobileNumber: '9876500010' }),
      membership('OPERATOR', { id: 'op_9', name: 'Op Sam', mobileNumber: '9876500012' }),
    ]);

    await notifyAssignedStaffNewBooking(['bk_1']);

    const where = (membershipFindManyMock.mock.calls[0][0] as { where: { role: { in: string[] } } }).where;
    expect(where.role.in).toEqual(['ADMIN', 'MODERATOR', 'OPERATOR']);
    expect(inAppAlerts().map((a) => a.userId).sort()).toEqual(['adm_1', 'mod_1', 'op_9']);
    expect(inAppAlerts().every((a) => a.title === 'New Booking')).toBe(true);
  });

  it('does not double-notify a subscriber who is also the assigned staff member', async () => {
    findManyMock.mockResolvedValue([
      bookingRow({
        category: 'COACHING',
        operationMode: null,
        assignedCoach: { id: 'coach_1', name: 'Coach Anil', mobileNumber: '9876500001' },
      }),
    ]);
    getPolicyJsonMock.mockResolvedValue(rolesOn('COACH', 'MODERATOR'));
    membershipFindManyMock.mockResolvedValue([
      // The assigned coach also holds a COACH membership — must not be paged twice.
      membership('COACH', { id: 'coach_1', name: 'Coach Anil', mobileNumber: '9876500001' }),
      membership('MODERATOR', { id: 'mod_1', name: 'Mod Priya', mobileNumber: '9876500010' }),
    ]);

    await notifyAssignedStaffNewBooking(['bk_1']);

    const alerts = inAppAlerts();
    expect(alerts).toHaveLength(2);
    expect(alerts.filter((a) => a.userId === 'coach_1')).toHaveLength(1);
    // The assigned copy wins — the coach keeps the "assigned to you" wording.
    expect(alerts.find((a) => a.userId === 'coach_1')?.title).toBe('New Booking Assigned');
    expect(alerts.find((a) => a.userId === 'mod_1')?.title).toBe('New Booking');
  });

  it('never sends the staff copy to the booker themselves', async () => {
    findManyMock.mockResolvedValue([bookingRow({ userId: 'mod_1' })]);
    membershipFindManyMock.mockResolvedValue([
      membership('MODERATOR', { id: 'mod_1', name: 'Mod Priya', mobileNumber: '9876500010' }),
    ]);

    await notifyAssignedStaffNewBooking(['bk_1']);

    // The moderator booked their own session — they get the customer
    // confirmation elsewhere, not this staff-style alert on top.
    expect(createMock).not.toHaveBeenCalled();
  });

  it('sends one alert per subscriber for a multi-slot booking, not one per slot', async () => {
    findManyMock.mockResolvedValue([
      bookingRow(),
      bookingRow({ id: 'bk_2', startTime: baseEnd, endTime: new Date('2026-06-03T11:30:00.000Z') }),
    ]);
    membershipFindManyMock.mockResolvedValue([
      membership('MODERATOR', { id: 'mod_1', name: 'Mod Priya', mobileNumber: '9876500010' }),
    ]);

    await notifyAssignedStaffNewBooking(['bk_1', 'bk_2']);

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppNotificationMock).toHaveBeenCalledTimes(1);
  });

  it('addresses a subscriber by their role and never says "assigned to you"', async () => {
    // Force the free-form text path so the message body is assertable.
    sendWhatsAppNotificationMock.mockResolvedValue({ success: false, error: 'template rejected' });
    findManyMock.mockResolvedValue([bookingRow()]);
    membershipFindManyMock.mockResolvedValue([
      membership('MODERATOR', { id: 'mod_1', name: 'Mod Priya', mobileNumber: '9876500010' }),
    ]);

    await notifyAssignedStaffNewBooking(['bk_1']);

    const text = sendWhatsAppTextMock.mock.calls[0][1] as string;
    expect(text).toContain('Hi Mod Priya (Center Moderator)');
    expect(text).toContain('A new booking has been made at your center.');
    expect(text).not.toContain('assigned to you');
    // Still carries the booking details staff need.
    expect(text).toContain('Rahul');
    expect(text).toContain('Indoor Net 2');
  });

  it('keeps subscribers in-app only when the center turns WhatsApp off', async () => {
    findManyMock.mockResolvedValue([bookingRow()]);
    getPolicyJsonMock.mockResolvedValue({ ...rolesOn('MODERATOR'), whatsapp: false });
    membershipFindManyMock.mockResolvedValue([
      membership('MODERATOR', { id: 'mod_1', name: 'Mod Priya', mobileNumber: '9876500010' }),
    ]);

    await notifyAssignedStaffNewBooking(['bk_1']);

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppNotificationMock).not.toHaveBeenCalled();
    expect(sendWhatsAppTextMock).not.toHaveBeenCalled();
  });

  it('turning WhatsApp off for subscribers does not mute the assigned staff', async () => {
    findManyMock.mockResolvedValue([
      bookingRow({
        category: 'COACHING',
        operationMode: null,
        assignedCoach: { id: 'coach_1', name: 'Coach Anil', mobileNumber: '9876500001' },
      }),
    ]);
    getPolicyJsonMock.mockResolvedValue({ ...rolesOn('MODERATOR'), whatsapp: false });
    membershipFindManyMock.mockResolvedValue([
      membership('MODERATOR', { id: 'mod_1', name: 'Mod Priya', mobileNumber: '9876500010' }),
    ]);

    await notifyAssignedStaffNewBooking(['bk_1']);

    expect(createMock).toHaveBeenCalledTimes(2);
    expect(sendWhatsAppNotificationMock).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppNotificationMock.mock.calls[0][0]).toBe('9876500001'); // the coach
  });

  it('skips the broadcast when the center turned new-booking alerts off', async () => {
    findManyMock.mockResolvedValue([bookingRow()]);
    getPolicyJsonMock.mockResolvedValue({
      ...rolesOn('MODERATOR'),
      events: { created: false, cancelled: true },
    });

    await notifyAssignedStaffNewBooking(['bk_1']);

    expect(membershipFindManyMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('still delivers to assigned staff when the subscriber lookup blows up', async () => {
    findManyMock.mockResolvedValue([
      bookingRow({
        category: 'COACHING',
        operationMode: null,
        assignedCoach: { id: 'coach_1', name: 'Coach Anil', mobileNumber: '9876500001' },
      }),
    ]);
    membershipFindManyMock.mockRejectedValue(new Error('db down'));

    await notifyAssignedStaffNewBooking(['bk_1']);

    expect(inAppAlerts()).toEqual([
      expect.objectContaining({ userId: 'coach_1', title: 'New Booking Assigned' }),
    ]);
  });

  it('pages a multi-role subscriber once, under the first enabled role', async () => {
    findManyMock.mockResolvedValue([bookingRow()]);
    getPolicyJsonMock.mockResolvedValue(rolesOn('ADMIN', 'GROUND_STAFF'));
    membershipFindManyMock.mockResolvedValue([
      // Same person, two enabled roles — GROUND_STAFF row first in the
      // DB ordering, but ADMIN wins as the earlier canonical role.
      membership('GROUND_STAFF', { id: 'dual_1', name: 'Dual Dev', mobileNumber: '9876500013' }),
      membership('ADMIN', { id: 'dual_1', name: 'Dual Dev', mobileNumber: '9876500013' }),
    ]);
    sendWhatsAppNotificationMock.mockResolvedValue({ success: false, error: 'template rejected' });

    await notifyAssignedStaffNewBooking(['bk_1']);

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppTextMock.mock.calls[0][1]).toContain('(Center Admin)');
  });

  it('links the alert to the booking so the Alerts view renders the full card', async () => {
    findManyMock.mockResolvedValue([bookingRow()]);
    membershipFindManyMock.mockResolvedValue([
      membership('MODERATOR', { id: 'mod_1', name: 'Mod Priya', mobileNumber: '9876500010' }),
    ]);

    await notifyAssignedStaffNewBooking(['bk_1']);

    const created = createMock.mock.calls[0][0] as { data: { bookingId: string | null } };
    expect(created.data.bookingId).toBe('bk_1');
  });

  it('names the subscriber role on the dedicated staff template', async () => {
    process.env.WHATSAPP_STAFF_BOOKING_TEMPLATE = 'staff_booking_alert';
    findManyMock.mockResolvedValue([bookingRow()]);
    membershipFindManyMock.mockResolvedValue([
      membership('MODERATOR', { id: 'mod_1', name: 'Mod Priya', mobileNumber: '9876500010' }),
    ]);

    await notifyAssignedStaffNewBooking(['bk_1']);

    const [, templateName, components] = sendWhatsAppNotificationMock.mock.calls[0];
    expect(templateName).toBe('staff_booking_alert');
    const params = ((components as { parameters?: { text?: string }[] }[])[0].parameters ?? []).map(
      (p) => p.text,
    );
    expect(params[1]).toBe('Center Moderator'); // {{2}} = recipient role
  });
});

describe('role subscribers — cancellations', () => {
  it('notifies the center moderator about a cancellation by default', async () => {
    findUniqueMock.mockResolvedValue(
      bookingRow({ cancelledBy: 'Admin Zoe', cancellationReason: 'Rain' }),
    );
    membershipFindManyMock.mockResolvedValue([
      membership('MODERATOR', { id: 'mod_1', name: 'Mod Priya', mobileNumber: '9876500010' }),
    ]);

    await notifyAssignedStaffBookingCancelled('bk_1');

    expect(getPolicyJsonMock).toHaveBeenCalledWith(BOOKING_NOTIFICATION_POLICY_KEY, 'ctr_1', null);
    const alerts = inAppAlerts();
    expect(alerts).toEqual([
      expect.objectContaining({ userId: 'mod_1', title: 'Booking Cancelled' }),
    ]);
    expect(alerts[0].message).toContain('Cancelled by: Admin Zoe');
    expect(alerts[0].message).toContain('Reason: Rain');
  });

  it('skips the broadcast when the center turned cancellation alerts off', async () => {
    findUniqueMock.mockResolvedValue(bookingRow());
    getPolicyJsonMock.mockResolvedValue({
      ...rolesOn('MODERATOR'),
      events: { created: true, cancelled: false },
    });

    await notifyAssignedStaffBookingCancelled('bk_1');

    expect(membershipFindManyMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('describes the booking rather than the recipient on the reused cancel template', async () => {
    findUniqueMock.mockResolvedValue(bookingRow({ cancelledBy: 'Admin Zoe' }));
    membershipFindManyMock.mockResolvedValue([
      membership('MODERATOR', { id: 'mod_1', name: 'Mod Priya', mobileNumber: '9876500010' }),
    ]);

    await notifyAssignedStaffBookingCancelled('bk_1');

    const [, templateName, components] = sendWhatsAppNotificationMock.mock.calls[0];
    expect(templateName).toBe('booking_cancelled');
    const detail = ((components as { parameters?: { text?: string }[] }[])[0].parameters ?? [])[0].text as string;
    // A moderator has no "session" — the line names the booking's category.
    expect(detail).toContain('Bowling Machine booking cancelled');
    expect(detail).not.toContain('Center Moderator session cancelled');
    expect(detail).toContain('Cancelled by: Admin Zoe');
  });

  it('does not tell the person who cancelled about their own action', async () => {
    findUniqueMock.mockResolvedValue(bookingRow({ cancelledBy: 'Admin Zoe' }));
    getPolicyJsonMock.mockResolvedValue(rolesOn('ADMIN', 'MODERATOR'));
    membershipFindManyMock.mockResolvedValue([
      membership('ADMIN', { id: 'adm_1', name: 'Admin Zoe', mobileNumber: '9876500011' }),
      membership('MODERATOR', { id: 'mod_1', name: 'Mod Priya', mobileNumber: '9876500010' }),
    ]);

    // Admin Zoe is doing the cancelling — an admin blocking a morning
    // must not be sent one message per booking about their own click.
    await notifyAssignedStaffBookingCancelled('bk_1', {
      cancelledBy: 'Admin Zoe',
      actorUserId: 'adm_1',
    });

    expect(inAppAlerts().map((a) => a.userId)).toEqual(['mod_1']);
    expect(sendWhatsAppNotificationMock).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppNotificationMock.mock.calls[0][0]).toBe('9876500010');
  });

  it('still notifies every subscriber when the actor is unknown', async () => {
    findUniqueMock.mockResolvedValue(bookingRow());
    getPolicyJsonMock.mockResolvedValue(rolesOn('ADMIN', 'MODERATOR'));
    membershipFindManyMock.mockResolvedValue([
      membership('ADMIN', { id: 'adm_1', name: 'Admin Zoe', mobileNumber: '9876500011' }),
      membership('MODERATOR', { id: 'mod_1', name: 'Mod Priya', mobileNumber: '9876500010' }),
    ]);

    await notifyAssignedStaffBookingCancelled('bk_1');

    expect(inAppAlerts().map((a) => a.userId).sort()).toEqual(['adm_1', 'mod_1']);
  });

  it('does not double-notify a subscriber who is also the assigned staff member', async () => {
    findUniqueMock.mockResolvedValue(
      bookingRow({
        category: 'SIDEARM',
        operationMode: null,
        assignedStaff: { id: 'spec_1', name: 'Spec Vik', mobileNumber: '9876500003' },
      }),
    );
    getPolicyJsonMock.mockResolvedValue(rolesOn('SIDEARM_SPECIALIST'));
    membershipFindManyMock.mockResolvedValue([
      membership('SIDEARM_SPECIALIST', { id: 'spec_1', name: 'Spec Vik', mobileNumber: '9876500003' }),
    ]);

    await notifyAssignedStaffBookingCancelled('bk_1');

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppNotificationMock).toHaveBeenCalledTimes(1);
  });
});
