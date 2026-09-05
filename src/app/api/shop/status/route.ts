import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';
import { resolveCurrentCenter } from '@/lib/centers';
import { sanitizeApiError } from '@/lib/api-errors';
import type { MarketplaceStatus } from '@/lib/marketplace';
import {
  PRODUCT_ORDER_BY,
  PRODUCT_SELECT,
  getMarketplaceConfig,
  resolveEnquiryPhone,
  toProductView,
} from '@/lib/marketplace-server';

/**
 * GET /api/shop/status — the one light payload every store highlight
 * reads: the Navbar / BottomNav "Shop" entry, the landing page's Gear Up
 * section, and the promo strip on /slots. Public (no session needed);
 * the center is resolved the same way as everywhere else (query →
 * cookie → membership → default).
 *
 * Returns the launch state, the enquiry number, a product count and up
 * to four published products (featured first) for the landing teaser.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    const center = await resolveCurrentCenter(req, user);
    const config = await getMarketplaceConfig(center?.id ?? null);

    const base: MarketplaceStatus = {
      enabled: !!center && config.enabled,
      comingSoon: config.comingSoon,
      launchNote: config.launchNote,
      enquiryPhone: resolveEnquiryPhone(config, center),
      center: center ? { id: center.id, name: center.name, slug: center.slug } : null,
      productCount: 0,
      featured: [],
    };

    if (!center || !config.enabled) {
      return NextResponse.json(base, { headers: CACHE_HEADERS });
    }

    const where = { centerId: center.id, isActive: true };
    const [productCount, featured] = await Promise.all([
      prisma.marketplaceProduct.count({ where }),
      prisma.marketplaceProduct.findMany({
        where,
        orderBy: PRODUCT_ORDER_BY,
        take: 4,
        select: PRODUCT_SELECT,
      }),
    ]);

    return NextResponse.json(
      { ...base, productCount, featured: featured.map(toProductView) } satisfies MarketplaceStatus,
      { headers: CACHE_HEADERS },
    );
  } catch (error) {
    const { message, status } = sanitizeApiError(error, 'shop.status');
    return NextResponse.json({ error: message }, { status });
  }
}

// Per-viewer (the center cookie picks the catalog), briefly cacheable so a
// page with three highlights doesn't hit the DB three times per load.
const CACHE_HEADERS = {
  'Cache-Control': 'private, max-age=30, stale-while-revalidate=120',
};
