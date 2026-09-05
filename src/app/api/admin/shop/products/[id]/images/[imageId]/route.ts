import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sanitizeApiError } from '@/lib/api-errors';
import { PRODUCT_IMAGE_META_SELECT, toImageMeta } from '@/lib/marketplace-server';
import { forbidden, requireShopAdmin } from '../../../../shared';

type Params = { id: string; imageId: string };

/**
 * DELETE /api/admin/shop/products/[id]/images/[imageId]
 *
 * Removes one photo and closes the gap in the remaining sort order so the
 * primary image is always at 0. The image must belong to the product and
 * the product to the caller's center.
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<Params> }) {
  try {
    const auth = await requireShopAdmin(req);
    if (!auth) return forbidden();
    const { id, imageId } = await ctx.params;

    const image = await prisma.marketplaceProductImage.findUnique({
      where: { id: imageId },
      select: { id: true, productId: true, product: { select: { centerId: true } } },
    });
    if (!image || image.productId !== id || image.product.centerId !== auth.center.id) {
      return NextResponse.json({ error: 'Image not found' }, { status: 404 });
    }

    const images = await prisma.$transaction(async (tx) => {
      await tx.marketplaceProductImage.delete({ where: { id: imageId } });
      const rest = await tx.marketplaceProductImage.findMany({
        where: { productId: id },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, sortOrder: true },
      });
      for (let i = 0; i < rest.length; i++) {
        if (rest[i].sortOrder !== i) {
          await tx.marketplaceProductImage.update({ where: { id: rest[i].id }, data: { sortOrder: i } });
        }
      }
      return tx.marketplaceProductImage.findMany({
        where: { productId: id },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: PRODUCT_IMAGE_META_SELECT,
      });
    });
    return NextResponse.json({ deleted: true, images: images.map(toImageMeta) });
  } catch (error) {
    const { message, status } = sanitizeApiError(error, 'admin.shop.image.delete');
    return NextResponse.json({ error: message }, { status });
  }
}
