import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// ─── Mocks ──────────────────────────────────────────────────────────
// Stub the session and the data layer so the handler can be driven with
// hand-built bodies and we can assert what it would persist. The
// address schema is NOT mocked — validation runs for real.

const addressCountMock = vi.fn();
const addressCreateMock = vi.fn();
const addressUpdateManyMock = vi.fn();
const addressFindManyMock = vi.fn();

// `$transaction(fn)` hands the callback the same client, so the count /
// updateMany / create inside the transaction land on these mocks too.
// The client is built inside the factory: `vi.mock` is hoisted above the
// `const` mocks, and only the lazily-invoked arrows may reference them.
vi.mock('@/lib/prisma', () => {
  const client = {
    userAddress: {
      count: (args: unknown) => addressCountMock(args),
      create: (args: unknown) => addressCreateMock(args),
      updateMany: (args: unknown) => addressUpdateManyMock(args),
      findMany: (args: unknown) => addressFindManyMock(args),
    },
  };
  return {
    prisma: {
      ...client,
      $transaction: (fn: (tx: typeof client) => Promise<unknown>) => fn(client),
    },
  };
});

const getAuthenticatedUserMock = vi.fn();
vi.mock('@/lib/auth', () => ({
  getAuthenticatedUser: (req: unknown) => getAuthenticatedUserMock(req),
}));

import { GET, POST } from './route';

const validBody = {
  label: 'Home',
  fullName: 'Rahul Sharma',
  phone: '+91 98765 43210',
  line1: '12 MG Road',
  city: 'Pune',
  state: 'Maharashtra',
  pincode: '411001',
  isDefault: false,
};

// Minimal stand-in for NextRequest — the handler only calls `.json()`.
const reqWith = (body: unknown) =>
  ({ json: async () => body, url: 'http://localhost/api/user/addresses' }) as unknown as NextRequest;

const storedRow = (data: Record<string, unknown>) => ({
  id: 'addr_1',
  label: null,
  line2: null,
  landmark: null,
  ...data,
  createdAt: new Date('2026-09-01T10:00:00.000Z'),
  updatedAt: new Date('2026-09-01T10:00:00.000Z'),
});

beforeEach(() => {
  vi.clearAllMocks();
  getAuthenticatedUserMock.mockResolvedValue({ id: 'usr_1' });
  addressCountMock.mockResolvedValue(0);
  addressUpdateManyMock.mockResolvedValue({ count: 0 });
  addressFindManyMock.mockResolvedValue([]);
  addressCreateMock.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
    storedRow(data),
  );
});

describe('GET /api/user/addresses', () => {
  it('answers 401 when signed out', async () => {
    getAuthenticatedUserMock.mockResolvedValue(null);
    const res = await GET(reqWith(undefined));
    expect(res.status).toBe(401);
    expect(addressFindManyMock).not.toHaveBeenCalled();
  });

  it("lists only the caller's addresses, default first, with the cap", async () => {
    addressFindManyMock.mockResolvedValue([storedRow({ ...validBody, phone: '9876543210', isDefault: true })]);
    const res = await GET(reqWith(undefined));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.max).toBe(5);
    expect(json.addresses).toHaveLength(1);
    expect(json.addresses[0]).toMatchObject({ id: 'addr_1', isDefault: true, phone: '9876543210' });
    expect(json.addresses[0].createdAt).toBe('2026-09-01T10:00:00.000Z');
    const where = (addressFindManyMock.mock.calls[0][0] as { where: unknown }).where;
    expect(where).toEqual({ userId: 'usr_1' });
  });
});

describe('POST /api/user/addresses', () => {
  it('answers 401 when signed out and never touches the database', async () => {
    getAuthenticatedUserMock.mockResolvedValue(null);
    const res = await POST(reqWith(validBody));
    expect(res.status).toBe(401);
    expect(addressCountMock).not.toHaveBeenCalled();
    expect(addressCreateMock).not.toHaveBeenCalled();
  });

  it('makes the first address the default even when the body says otherwise', async () => {
    addressCountMock.mockResolvedValue(0);
    const res = await POST(reqWith({ ...validBody, isDefault: false }));
    expect(res.status).toBe(201);
    expect(addressCreateMock).toHaveBeenCalledTimes(1);
    const data = (addressCreateMock.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.isDefault).toBe(true);
    expect(data.userId).toBe('usr_1');
    // The phone is stored normalised, not as typed.
    expect(data.phone).toBe('9876543210');
    const json = await res.json();
    expect(json.address).toMatchObject({ id: 'addr_1', isDefault: true, phone: '9876543210' });
    expect(Array.isArray(json.addresses)).toBe(true);
  });

  it('keeps a later address non-default when not asked, leaving the current default alone', async () => {
    addressCountMock.mockResolvedValue(2);
    const res = await POST(reqWith({ ...validBody, isDefault: false }));
    expect(res.status).toBe(201);
    expect(addressUpdateManyMock).not.toHaveBeenCalled();
    const data = (addressCreateMock.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.isDefault).toBe(false);
  });

  it('moves the default when a later address is added with isDefault true', async () => {
    addressCountMock.mockResolvedValue(2);
    const res = await POST(reqWith({ ...validBody, isDefault: true }));
    expect(res.status).toBe(201);
    expect(addressUpdateManyMock).toHaveBeenCalledTimes(1);
    expect(addressUpdateManyMock.mock.calls[0][0]).toEqual({
      where: { userId: 'usr_1', isDefault: true },
      data: { isDefault: false },
    });
    const data = (addressCreateMock.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.isDefault).toBe(true);
  });

  it('refuses a sixth address with the cap message and creates nothing', async () => {
    addressCountMock.mockResolvedValue(5);
    const res = await POST(reqWith(validBody));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('You can save up to 5 addresses — remove one to add another');
    expect(addressCreateMock).not.toHaveBeenCalled();
    expect(addressUpdateManyMock).not.toHaveBeenCalled();
  });

  it('answers 400 with the validation message for a bad phone and creates nothing', async () => {
    const res = await POST(reqWith({ ...validBody, phone: '12345' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Enter a valid 10-digit Indian mobile number');
    expect(addressCountMock).not.toHaveBeenCalled();
    expect(addressCreateMock).not.toHaveBeenCalled();
  });

  it('answers 400 for a body that is not JSON', async () => {
    const broken = {
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
      url: 'http://localhost/api/user/addresses',
    } as unknown as NextRequest;
    const res = await POST(broken);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid JSON');
  });
});
