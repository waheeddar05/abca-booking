import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// Only the session is stubbed; `canManageStore` is the real rule so this
// pins who runs the Cricket Store.
vi.mock('@/lib/prisma', () => ({ prisma: {} }));

const getAuthenticatedUserMock = vi.fn();
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return { ...actual, getAuthenticatedUser: (req: unknown) => getAuthenticatedUserMock(req) };
});

import { requireShopAdmin } from './shared';

const req = {} as NextRequest;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('requireShopAdmin — the store is run by store admins and super admins', () => {
  it('admits a store admin who is otherwise a plain customer', async () => {
    getAuthenticatedUserMock.mockResolvedValue({ id: 'u1', role: 'USER', isSuperAdmin: false, isStoreAdmin: true });
    const auth = await requireShopAdmin(req);
    expect(auth?.user.id).toBe('u1');
  });

  it('admits a super admin without the store flag', async () => {
    getAuthenticatedUserMock.mockResolvedValue({ id: 'u2', role: 'ADMIN', isSuperAdmin: true, isStoreAdmin: false });
    expect(await requireShopAdmin(req)).not.toBeNull();
  });

  it('rejects a center admin — the store is not a center’s', async () => {
    getAuthenticatedUserMock.mockResolvedValue({
      id: 'u3',
      role: 'ADMIN',
      isSuperAdmin: false,
      isStoreAdmin: false,
      centerMemberships: [{ centerId: 'ctr_abca', role: 'ADMIN' }],
    });
    expect(await requireShopAdmin(req)).toBeNull();
  });

  it('rejects a moderator and a signed-out visitor', async () => {
    getAuthenticatedUserMock.mockResolvedValue({ id: 'u4', role: 'MODERATOR', isSuperAdmin: false, isStoreAdmin: false });
    expect(await requireShopAdmin(req)).toBeNull();

    getAuthenticatedUserMock.mockResolvedValue(null);
    expect(await requireShopAdmin(req)).toBeNull();
  });
});
