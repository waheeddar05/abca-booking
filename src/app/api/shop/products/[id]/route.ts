import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';
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
 * Public. The Cricket Store is one catalog for all of PlayOrbit, so a
 * product link shared on WhatsApp opens for whoever taps it, whichever
 * center they book at.
 *
 * `interested` is whether the signed-in viewer has already tapped
 * "Notify me"; false for anonymous visitors.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<Params> }) {
  try {
    const { id } = await ctx.params;
    const [row, config, user] = await Promise.all([
      prisma.marketplaceProduct.findUnique({ where: { id }, select: PRODUCT_SELECT }),
      getMarketplaceConfig(),
      getAuthenticatedUser(req),
    ]);
    if (!row || !row.isActive || !config.enabled) {
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
        pickupNote: config.pickupNote,
      },
      enquiryPhone: resolveEnquiryPhone(config),
      interested,
      signedIn: !!user,
    });
  } catch (error) {
    const { message, status } = sanitizeApiError(error, 'shop.product');
    return NextResponse.json({ error: message }, { status });
  }
}
