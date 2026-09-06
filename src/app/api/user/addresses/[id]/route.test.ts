import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// ─── Mocks ──────────────────────────────────────────────────────────
// The ownership read and the default decision must happen INSIDE the
// serializable transaction, so the transaction stub records the order of
// calls made through its client. `runSerializable` is not mocked: it runs
// against the stubbed `prisma.$transaction`, which invokes the callback
// with the same client.

const findUniqueMock = vi.fn();
const findFirstMock = vi.fn();
const updateMock = vi.fn();
const updateManyMock = vi.fn();
const deleteMock = vi.fn();
const findManyMock = vi.fn();
const calls: string[] = [];

vi.mock('@/lib/prisma', () => {
  const client = {
    userAddress: {
      findUnique: (args: unknown) => {
        calls.push('findUnique');
        return findUniqueMock(args);
      },
      findFirst: (args: unknown) => {
        calls.push('findFirst');
        return findFirstMock(args);
      },
      update: (args: unknown) => {
        calls.push('update');
        return updateMock(args);
      },
      updateMany: (args: unknown) => {
        calls.push('updateMany');
        return updateManyMock(args);
      },
      delete: (args: unknown) => {
        calls.push('delete');
        return deleteMock(args);
      },
      findMany: (args: unknown) => findManyMock(args),
    },
  };
  return {
    prisma: {
      ...client,
      $transaction: (fn: (tx: typeof client) => Promise<unknown>) => {
        calls.push('tx:begin');
        return fn(client).finally(() => calls.push('tx:end'));
      },
    },
  };
});

const getAuthenticatedUserMock = vi.fn();
vi.mock('@/lib/auth', () => ({
  getAuthenticatedUser: (req: unknown) => getAuthenticatedUserMock(req),
}));

import { DELETE, PATCH } from './route';

const body = {
  label: 'Home',
  fullName: 'Rahul Sharma',
  phone: '9876543210',
  line1: '12 MG Road',
  city: 'Pune',
  state: 'Maharashtra',
  pincode: '411001',
  isDefault: false,
};

const reqWith = (json: unknown) =>
  ({ json: async () => json, url: 'http://localhost/api/user/addresses/addr_1' }) as unknown as NextRequest;
const ctx = { params: Promise.resolve({ id: 'addr_1' }) };

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'addr_1',
  label: 'Home',
  fullName: 'Rahul Sharma',
  phone: '9876543210',
  line1: '12 MG Road',
  line2: null,
  landmark: null,
  city: 'Pune',
  state: 'Maharashtra',
  pincode: '411001',
  isDefault: false,
  createdAt: new Date('2026-09-01T00:00:00Z'),
  updatedAt: new Date('2026-09-01T00:00:00Z'),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  getAuthenticatedUserMock.mockResolvedValue({ id: 'usr_1' });
  findManyMock.mockResolvedValue([]);
  updateManyMock.mockResolvedValue({ count: 1 });
  updateMock.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => row(data));
  deleteMock.mockResolvedValue(row());
});

describe('PATCH /api/user/addresses/[id]', () => {
  it('reads the row inside the serializable transaction, not before it', async () => {
    findUniqueMock.mockResolvedValue({ id: 'addr_1', userId: 'usr_1', isDefault: false });

    const res = await PATCH(reqWith(body), ctx);

    expect(res.status).toBe(200);
    expect(calls.indexOf('tx:begin')).toBeLessThan(calls.indexOf('findUnique'));
    expect(calls.indexOf('findUnique')).toBeLessThan(calls.indexOf('update'));
  });

  it('is 404 for another account’s address and writes nothing', async () => {
    findUniqueMock.mockResolvedValue({ id: 'addr_1', userId: 'usr_other', isDefault: false });

    const res = await PATCH(reqWith(body), ctx);

    expect(res.status).toBe(404);
    expect(updateMock).not.toHaveBeenCalled();
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it('moves the default here when asked, clearing the previous one first', async () => {
    findUniqueMock.mockResolvedValue({ id: 'addr_1', userId: 'usr_1', isDefault: false });

    const res = await PATCH(reqWith({ ...body, isDefault: true }), ctx);

    expect(res.status).toBe(200);
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { userId: 'usr_1', isDefault: true },
      data: { isDefault: false },
    });
    expect(updateMock.mock.calls[0][0].data.isDefault).toBe(true);
    expect(calls.indexOf('updateMany')).toBeLessThan(calls.indexOf('update'));
  });

  it('keeps the current default as the default even when the body says false', async () => {
    findUniqueMock.mockResolvedValue({ id: 'addr_1', userId: 'usr_1', isDefault: true });

    const res = await PATCH(reqWith({ ...body, isDefault: false }), ctx);

    expect(res.status).toBe(200);
    // Nothing else to clear — it already is the default.
    expect(updateManyMock).not.toHaveBeenCalled();
    expect(updateMock.mock.calls[0][0].data.isDefault).toBe(true);
  });

  it('rejects an invalid body before touching the database', async () => {
    const res = await PATCH(reqWith({ ...body, pincode: '12' }), ctx);

    expect(res.status).toBe(400);
    expect(findUniqueMock).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/user/addresses/[id]', () => {
  it('is 404 for another account’s address and deletes nothing', async () => {
    findUniqueMock.mockResolvedValue({ id: 'addr_1', userId: 'usr_other' });

    const res = await DELETE(reqWith(undefined), ctx);

    expect(res.status).toBe(404);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('promotes the oldest remaining address when no default is left', async () => {
    findUniqueMock.mockResolvedValue({ id: 'addr_1', userId: 'usr_1' });
    // First findFirst: is there still a default? No. Second: the oldest row.
    findFirstMock.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'addr_2' });

    const res = await DELETE(reqWith(undefined), ctx);

    expect(res.status).toBe(200);
    expect(deleteMock).toHaveBeenCalledWith({ where: { id: 'addr_1' } });
    expect(updateMock).toHaveBeenCalledWith({ where: { id: 'addr_2' }, data: { isDefault: true } });
    // Decided from the rows that remain, after the delete, inside the tx.
    expect(calls.indexOf('tx:begin')).toBeLessThan(calls.indexOf('findUnique'));
    expect(calls.indexOf('delete')).toBeLessThan(calls.indexOf('findFirst'));
  });

  it('leaves the defaults alone when one still exists', async () => {
    findUniqueMock.mockResolvedValue({ id: 'addr_1', userId: 'usr_1' });
    findFirstMock.mockResolvedValueOnce({ id: 'addr_9' });

    const res = await DELETE(reqWith(undefined), ctx);

    expect(res.status).toBe(200);
    expect(updateMock).not.toHaveBeenCalled();
    expect(findFirstMock).toHaveBeenCalledTimes(1);
  });

  it('does nothing more when the last address was deleted', async () => {
    findUniqueMock.mockResolvedValue({ id: 'addr_1', userId: 'usr_1' });
    findFirstMock.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    const res = await DELETE(reqWith(undefined), ctx);

    expect(res.status).toBe(200);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('is 401 when signed out', async () => {
    getAuthenticatedUserMock.mockResolvedValue(null);

    const res = await DELETE(reqWith(undefined), ctx);

    expect(res.status).toBe(401);
    expect(findUniqueMock).not.toHaveBeenCalled();
  });
});
