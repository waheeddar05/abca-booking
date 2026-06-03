import { describe, it, expect, vi, beforeEach } from 'vitest';

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
vi.mock('@/lib/whatsapp', () => ({
  sendWhatsAppText: (mobile: string, text: string) => sendWhatsAppTextMock(mobile, text),
  sendWhatsAppNotification: vi.fn(),
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
    centerId: 'ctr_1',
    cancelledBy: null,
    cancellationReason: null,
    center: { name: 'Toplay Indoor' },
    operator: null,
    assignedCoach: { id: 'coach_1', name: 'Coach Anil', mobileNumber: '9876500001' },
    assignedStaff: null,
    assignedMachine: null,
    resourceAssignments: [{ resource: { name: 'Indoor Net 2' } }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getCachedPolicyMock.mockResolvedValue('true'); // WhatsApp enabled
  sendWhatsAppTextMock.mockResolvedValue({ success: true, messageId: 'wamid.1' });
  createMock.mockResolvedValue({ id: 'notif_1' });
  // Default: no ground staff configured at the center. Tests that
  // exercise the ground-staff path override this per-case.
  membershipFindFirstMock.mockResolvedValue(null);
});

describe('notifyAssignedStaffNewBooking', () => {
  it('notifies every distinct assigned staff member (operator + coach + specialist)', async () => {
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

    // 3 WhatsApp messages (one per staff member with a mobile number)
    expect(sendWhatsAppTextMock).toHaveBeenCalledTimes(3);
    const recipients = sendWhatsAppTextMock.mock.calls.map((c) => c[0]).sort();
    expect(recipients).toEqual(['9876500001', '9876500002', '9876500003']);
    // 3 in-app notifications too
    expect(createMock).toHaveBeenCalledTimes(3);
  });

  it('includes the required booking details in the WhatsApp message', async () => {
    findManyMock.mockResolvedValue([bookingRow()]);

    await notifyAssignedStaffNewBooking(['bk_1']);

    const [, text] = sendWhatsAppTextMock.mock.calls[0];
    expect(text).toContain('New Booking');
    expect(text).toContain('Toplay Indoor'); // center name
    expect(text).toContain('Rahul'); // customer
    expect(text).toContain('Indoor Net 2'); // facility / resource
    expect(text).toContain('Personal Coaching'); // booking type
    expect(text).toContain('30 min'); // duration
    expect(text).toContain('Coach Anil'); // assigned coach detail
  });

  it('skips WhatsApp for staff without a mobile number but still records in-app', async () => {
    findManyMock.mockResolvedValue([
      bookingRow({ assignedCoach: { id: 'coach_1', name: 'Coach Anil', mobileNumber: null } }),
    ]);

    await notifyAssignedStaffNewBooking(['bk_1']);

    expect(sendWhatsAppTextMock).not.toHaveBeenCalled();
    expect(createMock).toHaveBeenCalledTimes(1); // in-app still created
  });

  it('does not send WhatsApp when the feature flag is off', async () => {
    getCachedPolicyMock.mockResolvedValue('false');
    findManyMock.mockResolvedValue([bookingRow()]);

    await notifyAssignedStaffNewBooking(['bk_1']);

    expect(sendWhatsAppTextMock).not.toHaveBeenCalled();
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('does nothing when no staff is assigned', async () => {
    findManyMock.mockResolvedValue([
      bookingRow({ operator: null, assignedCoach: null, assignedStaff: null }),
    ]);

    await notifyAssignedStaffNewBooking(['bk_1']);

    expect(sendWhatsAppTextMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('dedupes a staff member assigned in two roles across slots', async () => {
    findManyMock.mockResolvedValue([
      bookingRow({ assignedCoach: { id: 'coach_1', name: 'Coach Anil', mobileNumber: '9876500001' } }),
      bookingRow({ id: 'bk_2', assignedCoach: { id: 'coach_1', name: 'Coach Anil', mobileNumber: '9876500001' } }),
    ]);

    await notifyAssignedStaffNewBooking(['bk_1', 'bk_2']);

    expect(sendWhatsAppTextMock).toHaveBeenCalledTimes(1);
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
    expect(sendWhatsAppTextMock).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppTextMock.mock.calls[0][0]).toBe('9876500009');
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

    const recipients = sendWhatsAppTextMock.mock.calls.map((c) => c[0]).sort();
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

    expect(sendWhatsAppTextMock).toHaveBeenCalledTimes(1);
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
    expect(sendWhatsAppTextMock).toHaveBeenCalledTimes(1);
  });

  it('never throws even if the data lookup fails', async () => {
    findManyMock.mockRejectedValue(new Error('db down'));
    await expect(notifyAssignedStaffNewBooking(['bk_1'])).resolves.toBeUndefined();
  });
});

describe('notifyAssignedStaffBookingCancelled', () => {
  it('notifies assigned staff with cancellation details', async () => {
    findUniqueMock.mockResolvedValue(
      bookingRow({ assignedStaff: { id: 'staff_1', name: 'Spec Vik', mobileNumber: '9876500003' } }),
    );

    await notifyAssignedStaffBookingCancelled('bk_1', { cancelledBy: 'Admin', reason: 'Rain' });

    expect(sendWhatsAppTextMock).toHaveBeenCalled();
    const texts = sendWhatsAppTextMock.mock.calls.map((c) => c[1]);
    const joined = texts.join('\n');
    expect(joined).toContain('Cancelled');
    expect(joined).toContain('Toplay Indoor');
    expect(joined).toContain('Rahul');
    expect(joined).toContain('Indoor Net 2');
    expect(joined).toContain('Admin'); // cancelled by
    expect(joined).toContain('Rain'); // reason
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
