import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sanitizeApiError } from '@/lib/api-errors';
import {
  ImageLimitError,
  PRODUCT_IMAGE_META_SELECT,
  readImageUpload,
  storeProductImage,
  toImageMeta,
} from '@/lib/marketplace-server';
import { forbidden, readJson, requireShopAdmin } from '../../../shared';

type Params = { id: string };

/**
 *   POST  /api/admin/shop/products/[id]/images   multipart upload (`file`, optional `alt`)
 *   PATCH /api/admin/shop/products/[id]/images   { order: [imageId, …] } — reorder; first = primary
 *
 * Uploads are validated on the bytes (sniffed type, size ceiling) and
 * capped per product. The client resizes before sending, so a phone
 * photo arrives at a few hundred KB, not ten MB.
 */
async function ownedProduct(id: string, centerId: string) {
  const row = await prisma.marketplaceProduct.findUnique({ where: { id }, select: { id: true, centerId: true } });
  return row && row.centerId === centerId ? row : null;
}

const notFound = () => NextResponse.json({ error: 'Product not found' }, { status: 404 });

export async function POST(req: NextRequest, ctx: { params: Promise<Params> }) {
  try {
    const auth = await requireShopAdmin(req);
    if (!auth) return forbidden();
    const { id } = await ctx.params;
    if (!(await ownedProduct(id, auth.center.id))) return notFound();

    const upload = await readImageUpload(req);
    if (!upload.ok) return NextResponse.json({ error: upload.error }, { status: upload.status });

    const stored = await storeProductImage(id, upload);
    return NextResponse.json(toImageMeta(stored), { status: 201 });
  } catch (error) {
    if (error instanceof ImageLimitError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const { message, status } = sanitizeApiError(error, 'admin.shop.image.upload');
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<Params> }) {
  try {
    const auth = await requireShopAdmin(req);
    if (!auth) return forbidden();
    const { id } = await ctx.params;
    if (!(await ownedProduct(id, auth.center.id))) return notFound();

    const body = (await readJson(req)) as { order?: unknown } | undefined;
    const order = Array.isArray(body?.order) ? body!.order.filter((x): x is string => typeof x === 'string') : null;
    if (!order) return NextResponse.json({ error: 'order must be a list of image ids' }, { status: 400 });

    const existing = await prisma.marketplaceProductImage.findMany({
      where: { productId: id },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((e) => e.id));
    // Must be a permutation of exactly this product's images — no
    // missing ids (an image would vanish from the order), no foreign ones.
    if (order.length !== existingIds.size || new Set(order).size !== order.length || order.some((x) => !existingIds.has(x))) {
      return NextResponse.json({ error: 'order must list each of this product’s images exactly once' }, { status: 400 });
    }

    const images = await prisma.$transaction(async (tx) => {
      for (let i = 0; i < order.length; i++) {
        await tx.marketplaceProductImage.update({ where: { id: order[i] }, data: { sortOrder: i } });
      }
      return tx.marketplaceProductImage.findMany({
        where: { productId: id },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: PRODUCT_IMAGE_META_SELECT,
      });
    });
    return NextResponse.json({ images: images.map(toImageMeta) });
  } catch (error) {
    const { message, status } = sanitizeApiError(error, 'admin.shop.image.reorder');
    return NextResponse.json({ error: message }, { status });
  }
}
