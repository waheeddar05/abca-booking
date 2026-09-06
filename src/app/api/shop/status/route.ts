import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
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
 * reads: the Navbar / BottomNav "Store" entry, the landing page's Gear Up
 * section, and the promo strip on /slots. Public (no session needed) and
 * the same for every visitor: the Cricket Store is one catalog for all of
 * PlayOrbit, not a center's.
 *
 * Returns the launch state, the pickup note, the enquiry number, a product
 * count and up to four published products (featured first) for the
 * landing teaser.
 */
export async function GET() {
  try {
    const config = await getMarketplaceConfig();

    const base: MarketplaceStatus = {
      enabled: config.enabled,
      comingSoon: config.comingSoon,
      launchNote: config.launchNote,
      pickupNote: config.pickupNote,
      enquiryPhone: resolveEnquiryPhone(config),
      productCount: 0,
      featured: [],
    };

    if (!config.enabled) {
      return NextResponse.json(base, { headers: CACHE_HEADERS });
    }

    const where = { isActive: true };
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

// Not browser-cached: an admin's own settings save reads back through
// `invalidateMarketplaceStatus()` and must see the new value at once.
// De-duplication within a page load is the job of the module-level cache
// in `marketplace-status.tsx`.
const CACHE_HEADERS = {
  'Cache-Control': 'private, no-store',
};
