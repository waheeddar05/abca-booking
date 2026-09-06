import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { sanitizeApiError } from '@/lib/api-errors';
import { ProductInputSchema, isMarketplaceCategory } from '@/lib/marketplace';
import { PRODUCT_ORDER_BY, getMarketplaceConfig, resolveEnquiryPhone } from '@/lib/marketplace-server';
import { ADMIN_PRODUCT_SELECT, forbidden, readJson, requireShopAdmin, toAdminProductView } from '../shared';

/**
 * Admin → Cricket Store: the catalog.
 *
 *   GET  /api/admin/shop/products?status=all|active|inactive&category=BAT&q=
 *   POST /api/admin/shop/products
 *
 * Store admins and super admins only (see `requireShopAdmin`). One
 * catalog for all of PlayOrbit — nothing here is scoped to a center.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireShopAdmin(req);
    if (!auth) return forbidden();

    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status') || 'all';
    const category = searchParams.get('category') || '';
    const q = (searchParams.get('q') || '').trim().slice(0, 60);
    if (category && !isMarketplaceCategory(category)) {
      return NextResponse.json({ error: 'Unknown category' }, { status: 400 });
    }

    const where: Prisma.MarketplaceProductWhereInput = {
      ...(status === 'active' ? { isActive: true } : status === 'inactive' ? { isActive: false } : {}),
      ...(category ? { category } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { brand: { contains: q, mode: 'insensitive' } },
              { sku: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, config, counts] = await Promise.all([
      prisma.marketplaceProduct.findMany({ where, orderBy: PRODUCT_ORDER_BY, select: ADMIN_PRODUCT_SELECT }),
      getMarketplaceConfig(),
      prisma.marketplaceProduct.groupBy({
        by: ['isActive'],
        _count: { _all: true },
      }),
    ]);

    return NextResponse.json({
      products: rows.map(toAdminProductView),
      config,
      enquiryPhone: resolveEnquiryPhone(config),
      totals: {
        active: counts.find((c) => c.isActive)?._count._all ?? 0,
        inactive: counts.find((c) => !c.isActive)?._count._all ?? 0,
      },
    });
  } catch (error) {
    const { message, status } = sanitizeApiError(error, 'admin.shop.products.list');
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireShopAdmin(req);
    if (!auth) return forbidden();

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
    const created = await prisma.marketplaceProduct.create({
      data: {
        ...fields,
        specs: specs as Prisma.InputJsonValue,
        createdById: auth.user.id,
      },
      select: ADMIN_PRODUCT_SELECT,
    });
    return NextResponse.json(toAdminProductView(created), { status: 201 });
  } catch (error) {
    const { message, status } = sanitizeApiError(error, 'admin.shop.products.create');
    return NextResponse.json({ error: message }, { status });
  }
}
