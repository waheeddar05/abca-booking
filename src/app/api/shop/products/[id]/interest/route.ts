import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';
import { findCenterById } from '@/lib/centers';
import { sanitizeApiError } from '@/lib/api-errors';
import { getMarketplaceConfig } from '@/lib/marketplace-server';

type Params = { id: string };

/**
 * "Notify me when available" on a product.
 *
 *   POST   /api/shop/products/[id]/interest   register interest
 *   DELETE /api/shop/products/[id]/interest   withdraw it
 *
 * Signed-in users only — the route sits under the public /api/shop
 * prefix so an anonymous call reaches it and gets a clean JSON 401
 * (rather than the middleware's HTML redirect), which the product page
 * turns into a login prompt. Idempotent both ways.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<Params> }) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return NextResponse.json({ error: 'Please sign in to get notified' }, { status: 401 });

    const { id } = await ctx.params;
    const product = await prisma.marketplaceProduct.findUnique({
      where: { id },
      select: { id: true, isActive: true, centerId: true },
    });
    if (!product || !product.isActive) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }
    // Same visibility gate as the product page: a product whose center is
    // inactive or whose store is switched off isn't on offer, so it can't
    // collect interest either.
    const [center, config] = await Promise.all([
      findCenterById(product.centerId),
      getMarketplaceConfig(product.centerId),
    ]);
    if (!center || !center.isActive || !config.enabled) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    try {
      await prisma.marketplaceInterest.create({ data: { productId: id, userId: user.id } });
    } catch (err) {
      // Already registered — the unique (productId, userId) row exists.
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
    }
    return NextResponse.json({ interested: true });
  } catch (error) {
    const { message, status } = sanitizeApiError(error, 'shop.interest.add');
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<Params> }) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await ctx.params;
    await prisma.marketplaceInterest.deleteMany({ where: { productId: id, userId: user.id } });
    return NextResponse.json({ interested: false });
  } catch (error) {
    const { message, status } = sanitizeApiError(error, 'shop.interest.remove');
    return NextResponse.json({ error: message }, { status });
  }
}
