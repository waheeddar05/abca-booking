import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';
import { resolveCurrentCenter } from '@/lib/centers';
import { sanitizeApiError } from '@/lib/api-errors';
import {
  MARKETPLACE_CATEGORIES,
  isMarketplaceCategory,
  type MarketplaceCategoryCount,
} from '@/lib/marketplace';
import {
  PRODUCT_ORDER_BY,
  PRODUCT_SELECT,
  getMarketplaceConfig,
  resolveEnquiryPhone,
  toProductView,
} from '@/lib/marketplace-server';

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 60;
const MAX_OFFSET = 10_000;

/**
 * GET /api/shop/products?category=BAT&q=kashmir&limit=24&offset=0
 *
 * Public catalog for the current center: published products only, with
 * per-category counts for the filter chips. Anyone can browse — the
 * store is a marketing surface, like /centers — so sign-in is not
 * required; the center resolves from the cookie or the platform default.
 *
 * Paged by offset: `total` is the count for the active filter and
 * `hasMore` tells the page whether a "Load more" is worth showing, so the
 * grid can never silently stop short of what the chip counts promise.
 *
 * With the store switched off for the center (MARKETPLACE_CONFIG.enabled
 * = false) the list is empty and `config.enabled` tells the page why.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    const center = await resolveCurrentCenter(req, user);
    if (!center) {
      return NextResponse.json({ error: 'No center available' }, { status: 404 });
    }
    const config = await getMarketplaceConfig(center.id);
    const shared = {
      config: {
        enabled: config.enabled,
        comingSoon: config.comingSoon,
        launchNote: config.launchNote,
      },
      enquiryPhone: resolveEnquiryPhone(config, center),
      center: { id: center.id, name: center.name, slug: center.slug },
    };
    if (!config.enabled) {
      return NextResponse.json({
        ...shared,
        products: [],
        categories: [],
        total: 0,
        offset: 0,
        limit: DEFAULT_LIMIT,
        hasMore: false,
      });
    }

    const { searchParams } = new URL(req.url);
    const categoryParam = searchParams.get('category');
    const q = (searchParams.get('q') || '').trim().slice(0, 60);
    const limitRaw = Number(searchParams.get('limit'));
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(MAX_LIMIT, Math.floor(limitRaw)) : DEFAULT_LIMIT;
    const offsetRaw = Number(searchParams.get('offset'));
    const offset =
      Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.min(MAX_OFFSET, Math.floor(offsetRaw)) : 0;

    if (categoryParam && !isMarketplaceCategory(categoryParam)) {
      return NextResponse.json({ error: 'Unknown category' }, { status: 400 });
    }

    const base: Prisma.MarketplaceProductWhereInput = { centerId: center.id, isActive: true };
    const search: Prisma.MarketplaceProductWhereInput = q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { brand: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {};
    const where: Prisma.MarketplaceProductWhereInput = {
      ...base,
      ...search,
      ...(categoryParam ? { category: categoryParam } : {}),
    };

    const [rows, total, grouped] = await Promise.all([
      prisma.marketplaceProduct.findMany({
        where,
        orderBy: PRODUCT_ORDER_BY,
        skip: offset,
        take: limit,
        select: PRODUCT_SELECT,
      }),
      prisma.marketplaceProduct.count({ where }),
      // Counts ignore the category filter (so the chips keep their
      // numbers while one is selected) but honour the search.
      prisma.marketplaceProduct.groupBy({
        by: ['category'],
        where: { ...base, ...search },
        _count: { _all: true },
      }),
    ]);

    const countByCategory = new Map(grouped.map((g) => [g.category, g._count._all]));
    const categories: MarketplaceCategoryCount[] = MARKETPLACE_CATEGORIES.filter((c) =>
      countByCategory.has(c.value),
    ).map((c) => ({ value: c.value, label: c.label, count: countByCategory.get(c.value) ?? 0 }));

    return NextResponse.json({
      ...shared,
      products: rows.map(toProductView),
      categories,
      total,
      offset,
      limit,
      hasMore: offset + rows.length < total,
    });
  } catch (error) {
    const { message, status } = sanitizeApiError(error, 'shop.products');
    return NextResponse.json({ error: message }, { status });
  }
}
