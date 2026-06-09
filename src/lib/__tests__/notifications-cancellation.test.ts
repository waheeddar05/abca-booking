import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────
// buildCancellationDetailLines loads a single booking and returns the
// category-aware "what was booked" line(s) for a cancellation alert.
// We mock the data layer to assert that machine info appears ONLY for
// MACHINE bookings — and never leaks as a bogus "Machine: TENNIS" on a
// Sidearm / Coaching session (the bug this fixes).

const findUniqueMock = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: { findUnique: (args: unknown) => findUniqueMock(args) },
  },
}));

vi.mock('@/lib/policy-cache', () => ({
  getCachedPolicy: vi.fn(),
}));

vi.mock('@/lib/whatsapp', () => ({
  sendWhatsAppNotification: vi.fn(),
  sendWhatsAppText: vi.fn(),
}));

vi.mock('@/lib/time', () => ({
  formatIST: vi.fn(),
}));

vi.mock('@/lib/constants', () => ({
  MACHINES: {
    GRAVITY: { shortName: 'Gravity' },
    LEVERAGE_OUTDOOR: { shortName: 'Tennis Outdoor' },
  },
}));

import { buildCancellationDetailLines } from '../notifications';

/** Minimal booking row in the shape the helper's `select` returns. */
function bookingRow(overrides: Record<string, unknown> = {}) {
  return {
    category: 'SIDEARM',
    machineId: null,
    assignedMachine: null,
    assignedStaff: null,
    assignedCoach: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildCancellationDetailLines', () => {
  it('omits machine info and shows the specialist for a Sidearm booking', async () => {
    findUniqueMock.mockResolvedValue(
      bookingRow({ category: 'SIDEARM', assignedStaff: { name: 'Specialist Sam' } }),
    );

    const lines = await buildCancellationDetailLines('bk_1');

    // The core safety property: a Sidearm cancellation must NOT render a
    // "Machine: ..." line (it used to leak the TENNIS ballType default).
    expect(lines.some((l) => l.startsWith('Machine'))).toBe(false);
    expect(lines).toContain('Category: Sidearm');
    expect(lines).toContain('Sidearm Specialist: Specialist Sam');
  });

  it('shows only the category for a Sidearm booking with no assigned specialist', async () => {
    findUniqueMock.mockResolvedValue(bookingRow({ category: 'SIDEARM', assignedStaff: null }));

    const lines = await buildCancellationDetailLines('bk_1');

    expect(lines).toEqual(['Category: Sidearm']);
  });

  it('shows the coach for a Personal Coaching booking', async () => {
    findUniqueMock.mockResolvedValue(
      bookingRow({ category: 'COACHING', assignedCoach: { name: 'Coach Anil' } }),
    );

    const lines = await buildCancellationDetailLines('bk_1');

    expect(lines.some((l) => l.startsWith('Machine'))).toBe(false);
    expect(lines).toContain('Category: Personal Coaching');
    expect(lines).toContain('Coach: Coach Anil');
  });

  it('shows the machine for a legacy MACHINE booking', async () => {
    findUniqueMock.mockResolvedValue(bookingRow({ category: 'MACHINE', machineId: 'GRAVITY' }));

    const lines = await buildCancellationDetailLines('bk_1');

    expect(lines).toEqual(['Category: Bowling Machine', 'Machine: Gravity']);
  });

  it('shows the assigned machine for a resource-based MACHINE booking', async () => {
    findUniqueMock.mockResolvedValue(
      bookingRow({
        category: 'MACHINE',
        machineId: null,
        assignedMachine: { name: 'Yantra 1', shortName: null },
      }),
    );

    const lines = await buildCancellationDetailLines('bk_1');

    expect(lines).toEqual(['Category: Bowling Machine', 'Machine: Yantra 1']);
  });

  it('shows only the category for Cricket Nets / Full Court / Corporate', async () => {
    findUniqueMock.mockResolvedValue(bookingRow({ category: 'NET' }));
    expect(await buildCancellationDetailLines('bk_1')).toEqual(['Category: Cricket Nets']);

    findUniqueMock.mockResolvedValue(bookingRow({ category: 'FULL_COURT' }));
    expect(await buildCancellationDetailLines('bk_1')).toEqual(['Category: Full Indoor Court']);
  });

  it('includes pitch, payment and kit rows when present (admin-Bookings parity)', async () => {
    findUniqueMock.mockResolvedValue(
      bookingRow({
        category: 'MACHINE',
        machineId: 'GRAVITY',
        pitchType: 'ASTRO',
        ballType: 'LEATHER',
        operationMode: 'WITH_OPERATOR',
        operator: { name: 'Op Sam' },
        paymentMethod: 'ONLINE',
        kitRental: true,
        kitRentalCharge: 200,
      }),
    );

    const lines = await buildCancellationDetailLines('bk_1');

    expect(lines).toEqual([
      'Category: Bowling Machine',
      'Machine: Gravity',
      'Pitch: Astro Turf',
      'Ball: Leather Ball',
      'Operation: With Operator',
      'Operator: Op Sam',
      'Payment: Online',
      'Cricket Kit: ₹200',
    ]);
  });

  it('returns an empty array when the booking is missing', async () => {
    findUniqueMock.mockResolvedValue(null);
    expect(await buildCancellationDetailLines('missing')).toEqual([]);
  });

  it('never throws — returns an empty array on a lookup failure', async () => {
    findUniqueMock.mockRejectedValue(new Error('db down'));
    expect(await buildCancellationDetailLines('bk_1')).toEqual([]);
  });
});
