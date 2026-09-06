import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// ─── Mocks ──────────────────────────────────────────────────────────
// Stub the session and the data layer. The product schema, the row → view
// mapping and the store guard (`requireShopAdmin` → `canManageStore`) are
// NOT mocked, so a create round-trips through the real validation and the
// real permission rule. The store config comes from the real resolver
// over a stubbed policy lookup.

const productCreateMock = vi.fn();
const productFindManyMock = vi.fn();
const productGroupByMock = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    marketplaceProduct: {
      create: (args: unknown) => productCreateMock(args),
      findMany: (args: unknown) => productFindManyMock(args),
      groupBy: (args: unknown) => productGroupByMock(args),
    },
  },
}));

const getAuthenticatedUserMock = vi.fn();
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return { ...actual, getAuthenticatedUser: (req: unknown) => getAuthenticatedUserMock(req) };
});

const getPolicyJsonMock = vi.fn();
vi.mock('@/lib/policy', () => ({
  getPolicyJson: (...args: unknown[]) => getPolicyJsonMock(...args),
}));

import { GET, POST } from './route';

const storeAdmin = { id: 'store_1', role: 'USER', isSuperAdmin: false, isStoreAdmin: true };
const superAdmin = { id: 'super_1', role: 'ADMIN', isSuperAdmin: true, isStoreAdmin: false };
const centerAdmin = { id: 'admin_1', role: 'ADMIN', isSuperAdmin: false, isStoreAdmin: false };
const moderator = { id: 'mod_1', role: 'MODERATOR', isSuperAdmin: false, isStoreAdmin: false };

const validBody = {
  name: 'Player Edition',
  category: 'BAT',
  brand: '',
  price: 12500,
  mrp: 15000,
  specs: [
    { label: 'Willow', value: 'English' },
    { label: 'Weight', value: '1180 g' },
  ],
  sizes: ['SH'],
};

const postReq = (body: unknown) =>
  ({ json: async () => body, url: 'http://localhost/api/admin/shop/products' }) as unknown as NextRequest;

const getReq = (query = '') =>
  ({ url: `http://localhost/api/admin/shop/products${query}` }) as unknown as NextRequest;

beforeEach(() => {
  vi.clearAllMocks();
  getAuthenticatedUserMock.mockResolvedValue(storeAdmin);
  getPolicyJsonMock.mockResolvedValue(null);
  productFindManyMock.mockResolvedValue([]);
  productGroupByMock.mockResolvedValue([]);
  productCreateMock.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'prod_1',
    ...data,
    images: [],
    _count: { interests: 0 },
    createdAt: new Date('2026-09-01T10:00:00.000Z'),
    updatedAt: new Date('2026-09-01T10:00:00.000Z'),
  }));
});

describe('store guard — the Cricket Store is not a center’s', () => {
  it('answers 403 to a center admin on GET and POST', async () => {
    getAuthenticatedUserMock.mockResolvedValue(centerAdmin);

    const listRes = await GET(getReq());
    expect(listRes.status).toBe(403);
    expect((await listRes.json()).error).toBe('Unauthorized');
    expect(productFindManyMock).not.toHaveBeenCalled();

    const createRes = await POST(postReq(validBody));
    expect(createRes.status).toBe(403);
    expect(productCreateMock).not.toHaveBeenCalled();
  });

  it('answers 403 to a moderator', async () => {
    getAuthenticatedUserMock.mockResolvedValue(moderator);
    expect((await GET(getReq())).status).toBe(403);
    expect((await POST(postReq(validBody))).status).toBe(403);
  });

  it('answers 403 when nobody is signed in', async () => {
    getAuthenticatedUserMock.mockResolvedValue(null);
    expect((await GET(getReq())).status).toBe(403);
    expect((await POST(postReq(validBody))).status).toBe(403);
    expect(productCreateMock).not.toHaveBeenCalled();
  });

  it('lets a store admin who is otherwise a plain USER in', async () => {
    getAuthenticatedUserMock.mockResolvedValue(storeAdmin);
    expect((await GET(getReq())).status).toBe(200);
  });

  it('lets a super admin in without the store flag', async () => {
    getAuthenticatedUserMock.mockResolvedValue(superAdmin);
    expect((await GET(getReq())).status).toBe(200);
  });
});

describe('GET /api/admin/shop/products', () => {
  it('lists the whole catalog (no center scope) and reports the totals', async () => {
    productGroupByMock.mockResolvedValue([
      { isActive: true, _count: { _all: 3 } },
      { isActive: false, _count: { _all: 2 } },
    ]);
    const res = await GET(getReq('?status=active&category=BAT&q=player'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.products).toEqual([]);
    expect(json.totals).toEqual({ active: 3, inactive: 2 });
    expect(json).not.toHaveProperty('center');
    // No policy row → code defaults; no number configured → no WhatsApp buttons.
    expect(json.config).toMatchObject({ enabled: true, comingSoon: true, launchNote: '', enquiryPhone: '' });
    expect(json.config.pickupNote).toContain('Toplay');
    expect(json.enquiryPhone).toBeNull();

    const where = (productFindManyMock.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(where).not.toHaveProperty('centerId');
    expect(where.isActive).toBe(true);
    expect(where.category).toBe('BAT');
    expect(where.OR).toHaveLength(3);
    // Totals are store-wide too.
    expect(productGroupByMock.mock.calls[0][0]).not.toHaveProperty('where');
  });

  it('uses the configured store number for WhatsApp enquiries', async () => {
    getPolicyJsonMock.mockResolvedValue({ enquiryPhone: '+91 98765 43210' });
    const json = await (await GET(getReq())).json();
    expect(json.enquiryPhone).toBe('919876543210');
  });

  it('rejects a category outside the catalog', async () => {
    const res = await GET(getReq('?category=HELICOPTER'));
    expect(res.status).toBe(400);
    expect(productFindManyMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/shop/products', () => {
  it('answers 400 for an invalid product and creates nothing', async () => {
    const res = await POST(postReq({ ...validBody, mrp: 1000 }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('MRP cannot be lower than the selling price');
    expect(productCreateMock).not.toHaveBeenCalled();
  });

  it('answers 400 for a body that is not JSON', async () => {
    const broken = {
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
      url: 'http://localhost/api/admin/shop/products',
    } as unknown as NextRequest;
    const res = await POST(broken);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid JSON');
    expect(productCreateMock).not.toHaveBeenCalled();
  });

  it('creates the product with no center and stamps who added it', async () => {
    const res = await POST(postReq(validBody));
    expect(res.status).toBe(201);
    expect(productCreateMock).toHaveBeenCalledTimes(1);

    const data = (productCreateMock.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data).not.toHaveProperty('centerId');
    expect(data.createdById).toBe('store_1');
    expect(data.specs).toEqual(validBody.specs);
    expect(data.brand).toBeNull();
    expect(data.sizes).toEqual(['SH']);
    // Schema defaults are what get persisted — a new product starts unpublished.
    expect(data.isActive).toBe(false);
    expect(data.inStock).toBe(true);

    const json = await res.json();
    expect(json).toMatchObject({
      id: 'prod_1',
      name: 'Player Edition',
      category: 'BAT',
      categoryLabel: 'Cricket Bats',
      brand: null,
      price: 12500,
      mrp: 15000,
      discountPercent: 17,
      specs: validBody.specs,
      images: [],
      primaryImage: null,
      interestCount: 0,
    });
    expect(json.createdAt).toBe('2026-09-01T10:00:00.000Z');
  });
});
