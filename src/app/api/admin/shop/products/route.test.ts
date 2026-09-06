import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// ─── Mocks ──────────────────────────────────────────────────────────
// Stub the admin guard and the data layer. The product schema and the
// row → view mapping are NOT mocked, so a create round-trips through the
// real validation and the real `toAdminProductView`. The marketplace
// config comes from the real resolver over a stubbed policy lookup.

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

const requireCenterAdminMock = vi.fn();
vi.mock('@/lib/adminAuth', () => ({
  requireCenterAdmin: (req: unknown) => requireCenterAdminMock(req),
}));

vi.mock('@/lib/policy', () => ({
  getPolicyJson: vi.fn(async () => null),
}));

import { GET, POST } from './route';

const center = {
  id: 'ctr_abca',
  name: 'ABCA',
  slug: 'abca',
  contactPhone: '9876543210',
  contactPhones: null,
};

const fullAdmin = { user: { id: 'admin_1' }, center, isModerator: false };
const moderator = { user: { id: 'mod_1' }, center, isModerator: true };

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
  requireCenterAdminMock.mockResolvedValue(fullAdmin);
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

describe('admin guard', () => {
  it('answers 403 to a moderator on GET and POST — the store is full-admin only', async () => {
    requireCenterAdminMock.mockResolvedValue(moderator);

    const listRes = await GET(getReq());
    expect(listRes.status).toBe(403);
    expect((await listRes.json()).error).toBe('Unauthorized');
    expect(productFindManyMock).not.toHaveBeenCalled();

    const createRes = await POST(postReq(validBody));
    expect(createRes.status).toBe(403);
    expect(productCreateMock).not.toHaveBeenCalled();
  });

  it('answers 403 when the guard resolves nobody', async () => {
    requireCenterAdminMock.mockResolvedValue(null);
    expect((await GET(getReq())).status).toBe(403);
    expect((await POST(postReq(validBody))).status).toBe(403);
    expect(productCreateMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/shop/products', () => {
  it("scopes the list to the admin's current center and reports the totals", async () => {
    productGroupByMock.mockResolvedValue([
      { isActive: true, _count: { _all: 3 } },
      { isActive: false, _count: { _all: 2 } },
    ]);
    const res = await GET(getReq('?status=active&category=BAT&q=player'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.products).toEqual([]);
    expect(json.totals).toEqual({ active: 3, inactive: 2 });
    expect(json.center).toEqual({ id: 'ctr_abca', name: 'ABCA', slug: 'abca' });
    // No policy row → code defaults; enquiries fall back to the center's phone.
    expect(json.config).toEqual({ enabled: true, comingSoon: true, launchNote: '', enquiryPhone: '' });
    expect(json.enquiryPhone).toBe('919876543210');

    const where = (productFindManyMock.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(where.centerId).toBe('ctr_abca');
    expect(where.isActive).toBe(true);
    expect(where.category).toBe('BAT');
    expect(where.OR).toHaveLength(3);
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

  it("creates the product against the admin's center and stamps who added it", async () => {
    const res = await POST(postReq(validBody));
    expect(res.status).toBe(201);
    expect(productCreateMock).toHaveBeenCalledTimes(1);

    const data = (productCreateMock.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.centerId).toBe('ctr_abca');
    expect(data.createdById).toBe('admin_1');
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
