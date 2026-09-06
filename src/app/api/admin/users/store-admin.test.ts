import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// ─── Mocks ──────────────────────────────────────────────────────────
// The store grant is platform-level and super-admin only. Stub the
// session and the data layer; the permission rule in the route is real.

const userFindUniqueMock = vi.fn();
const userUpdateMock = vi.fn();

vi.mock('@/lib/prisma', () => {
  const client = {
    user: {
      findUnique: (args: unknown) => userFindUniqueMock(args),
      update: (args: unknown) => userUpdateMock(args),
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

vi.mock('@/lib/centers', () => ({
  resolveCurrentCenter: vi.fn(async () => ({ id: 'ctr_abca' })),
}));

import { PATCH } from './route';

const superAdmin = { id: 'super_1', role: 'ADMIN', isSuperAdmin: true, centerMemberships: [] };
const centerAdmin = { id: 'admin_1', role: 'ADMIN', isSuperAdmin: false, centerMemberships: [] };

const reqWith = (body: unknown) =>
  ({ json: async () => body, url: 'http://localhost/api/admin/users' }) as unknown as NextRequest;

beforeEach(() => {
  vi.clearAllMocks();
  getAuthenticatedUserMock.mockResolvedValue(superAdmin);
  userFindUniqueMock.mockResolvedValue({ id: 'usr_9', email: null, role: 'USER', isStoreAdmin: false });
  userUpdateMock.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'usr_9',
    role: 'USER',
    ...data,
  }));
});

describe('PATCH /api/admin/users — isStoreAdmin', () => {
  it('lets a super admin grant the store, without touching the role or any center', async () => {
    const res = await PATCH(reqWith({ id: 'usr_9', isStoreAdmin: true }));

    expect(res.status).toBe(200);
    expect(userUpdateMock).toHaveBeenCalledTimes(1);
    const data = (userUpdateMock.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data).toEqual({ isStoreAdmin: true });
  });

  it('lets a super admin revoke it', async () => {
    const res = await PATCH(reqWith({ id: 'usr_9', isStoreAdmin: false }));

    expect(res.status).toBe(200);
    const data = (userUpdateMock.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data).toEqual({ isStoreAdmin: false });
  });

  it('answers 403 to a center admin — the store is not a center’s to staff', async () => {
    getAuthenticatedUserMock.mockResolvedValue(centerAdmin);

    const res = await PATCH(reqWith({ id: 'usr_9', isStoreAdmin: true }));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('Only super admin can grant store admin');
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects a non-boolean value', async () => {
    const res = await PATCH(reqWith({ id: 'usr_9', isStoreAdmin: 'yes' }));

    expect(res.status).toBe(400);
    expect(userUpdateMock).not.toHaveBeenCalled();
  });
});
