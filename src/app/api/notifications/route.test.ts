import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────
// Drive the handler with hand-built rows and assert the ownership flag
// the Alerts view relies on, without a real DB or session.

const notificationFindManyMock = vi.fn();
const bookingFindManyMock = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    notification: {
      findMany: (args: unknown) => notificationFindManyMock(args),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    booking: {
      findMany: (args: unknown) => bookingFindManyMock(args),
    },
  },
}));

vi.mock('@/lib/auth', () => ({
  getAuthenticatedUser: vi.fn(async () => ({ id: 'viewer_1' })),
}));

const loadBookingCardsMock = vi.fn();
vi.mock('@/lib/booking-card', () => ({
  loadBookingCards: (ids: string[]) => loadBookingCardsMock(ids),
}));

import { GET } from './route';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const req = {} as any;

function notification(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ntf_1',
    userId: 'viewer_1',
    title: 'New Booking',
    message: 'Customer: Rahul | Phone: 9990001111',
    type: 'SUCCESS',
    isRead: false,
    createdAt: new Date('2026-06-03T10:00:00.000Z'),
    bookingId: 'bk_1',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  loadBookingCardsMock.mockResolvedValue(new Map([['bk_1', { id: 'bk_1' }]]));
  bookingFindManyMock.mockResolvedValue([{ id: 'bk_1', userId: 'viewer_1' }]);
});

describe('GET /api/notifications — isOwnBooking', () => {
  it("marks the viewer's own booking confirmation as their own", async () => {
    notificationFindManyMock.mockResolvedValue([notification()]);

    const res = await GET(req);
    const body = await res.json();

    expect(body[0].isOwnBooking).toBe(true);
    expect(body[0].booking).toEqual({ id: 'bk_1' });
  });

  it("marks a staff / role-subscriber alert about someone else's booking as NOT own", async () => {
    // The moderator is the viewer; the booking belongs to a customer.
    notificationFindManyMock.mockResolvedValue([notification()]);
    bookingFindManyMock.mockResolvedValue([{ id: 'bk_1', userId: 'customer_1' }]);

    const res = await GET(req);
    const body = await res.json();

    // This is what makes the Alerts view show the booker's phone (operator
    // role) and keep the detail text alongside the card snapshot.
    expect(body[0].isOwnBooking).toBe(false);
  });

  it('treats an alert with no linked booking as own (nothing to disambiguate)', async () => {
    notificationFindManyMock.mockResolvedValue([notification({ bookingId: null })]);
    loadBookingCardsMock.mockResolvedValue(new Map());

    const res = await GET(req);
    const body = await res.json();

    expect(body[0].booking).toBeNull();
    expect(body[0].isOwnBooking).toBe(true);
    // No booking ids → no owner lookup at all.
    expect(bookingFindManyMock).not.toHaveBeenCalled();
  });

  it('falls back to "own" when the owner lookup fails, and still returns the cards', async () => {
    notificationFindManyMock.mockResolvedValue([notification()]);
    bookingFindManyMock.mockRejectedValue(new Error('db down'));

    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body[0].isOwnBooking).toBe(true);
    expect(body[0].booking).toEqual({ id: 'bk_1' });
  });

  it('looks the owners up in one query for a page of alerts', async () => {
    notificationFindManyMock.mockResolvedValue([
      notification({ id: 'ntf_1', bookingId: 'bk_1' }),
      notification({ id: 'ntf_2', bookingId: 'bk_2' }),
      notification({ id: 'ntf_3', bookingId: null }),
    ]);
    loadBookingCardsMock.mockResolvedValue(
      new Map([
        ['bk_1', { id: 'bk_1' }],
        ['bk_2', { id: 'bk_2' }],
      ]),
    );
    bookingFindManyMock.mockResolvedValue([
      { id: 'bk_1', userId: 'viewer_1' },
      { id: 'bk_2', userId: 'customer_9' },
    ]);

    const res = await GET(req);
    const body = await res.json();

    expect(bookingFindManyMock).toHaveBeenCalledTimes(1);
    expect(body.map((n: { isOwnBooking: boolean }) => n.isOwnBooking)).toEqual([true, false, true]);
  });

  it('rejects an unauthenticated request', async () => {
    const { getAuthenticatedUser } = await import('@/lib/auth');
    vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(null);

    const res = await GET(req);

    expect(res.status).toBe(401);
    expect(notificationFindManyMock).not.toHaveBeenCalled();
  });
});
