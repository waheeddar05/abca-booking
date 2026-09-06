import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// ─── Mocks ──────────────────────────────────────────────────────────
// Anonymous visitor, one center, no MARKETPLACE_CONFIG row (defaults).
// The config normaliser, the view mapper and the pagination maths run
// for real; only the data layer is stubbed.

const findManyMock = vi.fn();
const countMock = vi.fn();
const groupByMock = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    marketplaceProduct: {
      findMany: (args: unknown) => findManyMock(args),
      count: (args: unknown) => countMock(args),
      groupBy: (args: unknown) => groupByMock(args),
    },
  },
}));

vi.mock('@/lib/auth', () => ({
  getAuthenticatedUser: vi.fn(async () => null),
}));

const center = {
  id: 'ctr_abca',
  slug: 'abca',
  name: 'ABCA',
  isActive: true,
  contactPhone: '9876543210',
  contactPhones: null,
};
vi.mock('@/lib/centers', () => ({
  resolveCurrentCenter: vi.fn(async () => center),
}));

const getPolicyJsonMock = vi.fn();
vi.mock('@/lib/policy', () => ({
  getPolicyJson: (...args: unknown[]) => getPolicyJsonMock(...args),
}));

import { GET } from './route';

const req = (query = '') =>
  ({ url: `http://localhost/api/shop/products${query}` }) as unknown as NextRequest;

const product = (id: string) => ({
  id,
  centerId: 'ctr_abca',
  name: `Bat ${id}`,
  category: 'BAT',
  brand: 'SS',
  sku: null,
  description: null,
  price: 1500,
  mrp: 2000,
  stockQty: null,
  inStock: true,
  isActive: true,
  isFeatured: false,
  displayOrder: 0,
  sizes: [],
  specs: [],
  createdAt: new Date('2026-09-01T00:00:00Z'),
  updatedAt: new Date('2026-09-01T00:00:00Z'),
  images: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  getPolicyJsonMock.mockResolvedValue(null);
  groupByMock.mockResolvedValue([{ category: 'BAT', _count: { _all: 30 } }]);
});

describe('GET /api/shop/products — paging', () => {
  it('pages by offset and reports the total so the grid can grow to the chip count', async () => {
    findManyMock.mockResolvedValue([product('p25'), product('p26')]);
    countMock.mockResolvedValue(30);

    const res = await GET(req('?offset=24&limit=24'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(findManyMock.mock.calls[0][0]).toMatchObject({ skip: 24, take: 24 });
    expect(json.total).toBe(30);
    expect(json.offset).toBe(24);
    expect(json.hasMore).toBe(true); // 24 + 2 < 30
    expect(json.products.map((p: { id: string }) => p.id)).toEqual(['p25', 'p26']);
    expect(json.categories).toEqual([{ value: 'BAT', label: 'Cricket Bats', count: 30 }]);
  });

  it('says there is no more once the last page is served', async () => {
    findManyMock.mockResolvedValue([product('p30')]);
    countMock.mockResolvedValue(30);

    const json = await (await GET(req('?offset=29'))).json();

    expect(json.hasMore).toBe(false);
  });

  it('defaults to 24 per page from the start and clamps an oversized limit', async () => {
    findManyMock.mockResolvedValue([]);
    countMock.mockResolvedValue(0);

    await GET(req());
    expect(findManyMock.mock.calls[0][0]).toMatchObject({ skip: 0, take: 24 });

    await GET(req('?limit=500&offset=-5'));
    expect(findManyMock.mock.calls[1][0]).toMatchObject({ skip: 0, take: 60 });
  });

  it('scopes to published products at the current center and honours the category filter', async () => {
    findManyMock.mockResolvedValue([]);
    countMock.mockResolvedValue(0);

    await GET(req('?category=BAT'));

    expect(findManyMock.mock.calls[0][0].where).toMatchObject({
      centerId: 'ctr_abca',
      isActive: true,
      category: 'BAT',
    });
    // The chip counts ignore the category filter so the chips keep their numbers.
    expect(groupByMock.mock.calls[0][0].where).not.toHaveProperty('category');
  });

  it('rejects a category outside the catalog', async () => {
    const res = await GET(req('?category=BOATS'));
    expect(res.status).toBe(400);
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it('returns an empty, unpaged catalog when the store is switched off', async () => {
    getPolicyJsonMock.mockResolvedValue({ enabled: false, comingSoon: true });

    const json = await (await GET(req())).json();

    expect(json.config.enabled).toBe(false);
    expect(json.products).toEqual([]);
    expect(json.hasMore).toBe(false);
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it('falls back to the center contact number for WhatsApp enquiries', async () => {
    findManyMock.mockResolvedValue([]);
    countMock.mockResolvedValue(0);

    const json = await (await GET(req())).json();

    expect(json.enquiryPhone).toBe('919876543210');
    expect(json.config.comingSoon).toBe(true);
  });
});
