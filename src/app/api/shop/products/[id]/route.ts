import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';
import { findCenterById } from '@/lib/centers';
import { sanitizeApiError } from '@/lib/api-errors';
import {
  PRODUCT_SELECT,
  getMarketplaceConfig,
  resolveEnquiryPhone,
  toProductView,
} from '@/lib/marketplace-server';

type Params = { id: string };

/**
 * GET /api/shop/products/[id] — one published product.
 *
 * Looked up by id alone, not by the viewer's current center: a product
 * link shared on WhatsApp must open for whoever taps it, whichever
 * center their cookie happens to point at. The launch config and the
 * enquiry number therefore come from the product's own center.
 *
 * `interested` is whether the signed-in viewer has already tapped
 * "Notify me"; false for anonymous visitors.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<Params> }) {
  try {
    const { id } = await ctx.params;
    const row = await prisma.marketplaceProduct.findUnique({
      where: { id },
      select: PRODUCT_SELECT,
    });
    if (!row || !row.isActive) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    const [center, config, user] = await Promise.all([
      findCenterById(row.centerId),
      getMarketplaceConfig(row.centerId),
      getAuthenticatedUser(req),
    ]);
    if (!center || !center.isActive || !config.enabled) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    const interested = user
      ? !!(await prisma.marketplaceInterest.findUnique({
          where: { productId_userId: { productId: id, userId: user.id } },
          select: { id: true },
        }))
      : false;

    return NextResponse.json({
      product: toProductView(row),
      config: {
        enabled: config.enabled,
        comingSoon: config.comingSoon,
        launchNote: config.launchNote,
      },
      enquiryPhone: resolveEnquiryPhone(config, center),
      center: { id: center.id, name: center.name, slug: center.slug },
      interested,
      signedIn: !!user,
    });
  } catch (error) {
    const { message, status } = sanitizeApiError(error, 'shop.product');
    return NextResponse.json({ error: message }, { status });
  }
}
