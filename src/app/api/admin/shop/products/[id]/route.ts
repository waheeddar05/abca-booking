import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { sanitizeApiError } from '@/lib/api-errors';
import { ProductInputSchema, type MarketplaceInterestView } from '@/lib/marketplace';
import { ADMIN_PRODUCT_SELECT, forbidden, readJson, requireShopAdmin, toAdminProductView } from '../../shared';

type Params = { id: string };

/**
 *   GET    /api/admin/shop/products/[id]   product + the users who want it
 *   PATCH  /api/admin/shop/products/[id]   replace (complete body)
 *   DELETE /api/admin/shop/products/[id]   remove (cascades images + interests)
 *
 * Every verb re-fetches the row and checks it belongs to the caller's
 * current center before touching it. PATCH takes the whole product, same
 * schema as create, so a field can't be blanked in isolation.
 */
async function ownedProduct(id: string, centerId: string) {
  const row = await prisma.marketplaceProduct.findUnique({
    where: { id },
    select: { id: true, centerId: true },
  });
  return row && row.centerId === centerId ? row : null;
}

const notFound = () => NextResponse.json({ error: 'Product not found' }, { status: 404 });

export async function GET(req: NextRequest, ctx: { params: Promise<Params> }) {
  try {
    const auth = await requireShopAdmin(req);
    if (!auth) return forbidden();
    const { id } = await ctx.params;
    if (!(await ownedProduct(id, auth.center.id))) return notFound();

    const [row, interestRows] = await Promise.all([
      prisma.marketplaceProduct.findUnique({ where: { id }, select: ADMIN_PRODUCT_SELECT }),
      prisma.marketplaceInterest.findMany({
        where: { productId: id },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          createdAt: true,
          user: { select: { id: true, name: true, mobileNumber: true } },
        },
      }),
    ]);
    if (!row) return notFound();

    const interests: MarketplaceInterestView[] = interestRows.map((r) => ({
      id: r.id,
      userId: r.user.id,
      name: r.user.name,
      mobileNumber: r.user.mobileNumber,
      createdAt: r.createdAt.toISOString(),
    }));

    return NextResponse.json({ product: toAdminProductView(row), interests });
  } catch (error) {
    const { message, status } = sanitizeApiError(error, 'admin.shop.product.get');
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<Params> }) {
  try {
    const auth = await requireShopAdmin(req);
    if (!auth) return forbidden();
    const { id } = await ctx.params;
    if (!(await ownedProduct(id, auth.center.id))) return notFound();

    const body = await readJson(req);
    if (body === undefined) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    const parsed = ProductInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Validation failed' },
        { status: 400 },
      );
    }

    const { specs, ...fields } = parsed.data;
    const updated = await prisma.marketplaceProduct.update({
      where: { id },
      data: { ...fields, specs: specs as Prisma.InputJsonValue },
      select: ADMIN_PRODUCT_SELECT,
    });
    return NextResponse.json(toAdminProductView(updated));
  } catch (error) {
    const { message, status } = sanitizeApiError(error, 'admin.shop.product.update');
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<Params> }) {
  try {
    const auth = await requireShopAdmin(req);
    if (!auth) return forbidden();
    const { id } = await ctx.params;
    if (!(await ownedProduct(id, auth.center.id))) return notFound();

    await prisma.marketplaceProduct.delete({ where: { id } });
    return NextResponse.json({ deleted: true });
  } catch (error) {
    const { message, status } = sanitizeApiError(error, 'admin.shop.product.delete');
    return NextResponse.json({ error: message }, { status });
  }
}
