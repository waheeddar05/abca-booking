import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';

// ─── Mocks ──────────────────────────────────────────────────────────
// Stub the session and the two tables the route touches. The P2002
// handling is exercised with a real PrismaClientKnownRequestError so the
// instanceof check in the route is what's under test.

const productFindUniqueMock = vi.fn();
const interestCreateMock = vi.fn();
const interestDeleteManyMock = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    marketplaceProduct: {
      findUnique: (args: unknown) => productFindUniqueMock(args),
    },
    marketplaceInterest: {
      create: (args: unknown) => interestCreateMock(args),
      deleteMany: (args: unknown) => interestDeleteManyMock(args),
    },
  },
}));

const getAuthenticatedUserMock = vi.fn();
vi.mock('@/lib/auth', () => ({
  getAuthenticatedUser: (req: unknown) => getAuthenticatedUserMock(req),
}));

// The POST applies the product page's visibility gate: the product's
// center must be active and its store switched on. Both are stubbed at
// the module boundary so the real config normaliser still runs.
const findCenterByIdMock = vi.fn();
vi.mock('@/lib/centers', () => ({
  findCenterById: (id: string) => findCenterByIdMock(id),
}));

const getPolicyJsonMock = vi.fn();
vi.mock('@/lib/policy', () => ({
  getPolicyJson: (...args: unknown[]) => getPolicyJsonMock(...args),
}));

import { DELETE, POST } from './route';

const req = () =>
  ({ url: 'http://localhost/api/shop/products/p1/interest' }) as unknown as NextRequest;
const ctx = { params: Promise.resolve({ id: 'p1' }) };

beforeEach(() => {
  vi.clearAllMocks();
  getAuthenticatedUserMock.mockResolvedValue({ id: 'usr_1' });
  productFindUniqueMock.mockResolvedValue({ id: 'p1', isActive: true, centerId: 'ctr_abca' });
  findCenterByIdMock.mockResolvedValue({ id: 'ctr_abca', isActive: true });
  // No MARKETPLACE_CONFIG row → defaults (enabled, coming soon).
  getPolicyJsonMock.mockResolvedValue(null);
  interestCreateMock.mockResolvedValue({ id: 'int_1' });
  interestDeleteManyMock.mockResolvedValue({ count: 1 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/shop/products/[id]/interest', () => {
  it('answers a JSON 401 when signed out so the product page can prompt a login', async () => {
    getAuthenticatedUserMock.mockResolvedValue(null);
    const res = await POST(req(), ctx);
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('Please sign in to get notified');
    expect(interestCreateMock).not.toHaveBeenCalled();
  });

  it('answers 404 for an unpublished product', async () => {
    productFindUniqueMock.mockResolvedValue({ id: 'p1', isActive: false });
    const res = await POST(req(), ctx);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Product not found');
    expect(interestCreateMock).not.toHaveBeenCalled();
  });

  it('answers 404 for a product that does not exist', async () => {
    productFindUniqueMock.mockResolvedValue(null);
    const res = await POST(req(), ctx);
    expect(res.status).toBe(404);
    expect(interestCreateMock).not.toHaveBeenCalled();
  });

  it('registers the interest row for this user and product', async () => {
    const res = await POST(req(), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ interested: true });
    expect(productFindUniqueMock.mock.calls[0][0]).toMatchObject({ where: { id: 'p1' } });
    expect(interestCreateMock).toHaveBeenCalledTimes(1);
    expect(interestCreateMock.mock.calls[0][0]).toEqual({ data: { productId: 'p1', userId: 'usr_1' } });
  });

  it('is idempotent — a duplicate (P2002) still answers interested: true', async () => {
    interestCreateMock.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }),
    );
    const res = await POST(req(), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ interested: true });
  });

  it('does not swallow other database errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    interestCreateMock.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: 'test' }),
    );
    const res = await POST(req(), ctx);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Something went wrong. Please try again.' });
  });
});

describe('DELETE /api/shop/products/[id]/interest', () => {
  it('answers 401 when signed out', async () => {
    getAuthenticatedUserMock.mockResolvedValue(null);
    const res = await DELETE(req(), ctx);
    expect(res.status).toBe(401);
    expect(interestDeleteManyMock).not.toHaveBeenCalled();
  });

  it("withdraws only this user's interest in this product and answers interested: false", async () => {
    const res = await DELETE(req(), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ interested: false });
    expect(interestDeleteManyMock).toHaveBeenCalledTimes(1);
    expect(interestDeleteManyMock.mock.calls[0][0]).toEqual({ where: { productId: 'p1', userId: 'usr_1' } });
  });

  it('is idempotent — withdrawing when nothing was registered still answers interested: false', async () => {
    interestDeleteManyMock.mockResolvedValue({ count: 0 });
    const res = await DELETE(req(), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ interested: false });
  });
});

describe('POST /api/shop/products/[id]/interest — store visibility gate', () => {
  it('is 404 when the product’s center is inactive, like the product page', async () => {
    findCenterByIdMock.mockResolvedValue({ id: 'ctr_abca', isActive: false });

    const res = await POST(req(), ctx);

    expect(res.status).toBe(404);
    expect(interestCreateMock).not.toHaveBeenCalled();
  });

  it('is 404 when the center has the store switched off', async () => {
    getPolicyJsonMock.mockResolvedValue({ enabled: false, comingSoon: true });

    const res = await POST(req(), ctx);

    expect(res.status).toBe(404);
    expect(interestCreateMock).not.toHaveBeenCalled();
  });

  it('is 404 when the center row is missing', async () => {
    findCenterByIdMock.mockResolvedValue(null);

    const res = await POST(req(), ctx);

    expect(res.status).toBe(404);
    expect(interestCreateMock).not.toHaveBeenCalled();
  });
});
