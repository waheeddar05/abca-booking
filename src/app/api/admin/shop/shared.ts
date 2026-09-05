import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireCenterAdmin } from '@/lib/adminAuth';
import { PRODUCT_SELECT, toProductView, type ProductRow } from '@/lib/marketplace-server';
import type { MarketplaceProductAdminView } from '@/lib/marketplace';

/**
 * Admin → Marketplace is a **full-admin** surface, like Offers: moderators
 * run the floor (bookings, slots, packages, ledger) but do not price or
 * stock the store. `requireCenterAdmin` admits both roles and reports
 * `isModerator`, so every route here rejects on that flag — the second
 * layer behind the middleware's /admin/shop block.
 */
export async function requireShopAdmin(req: NextRequest) {
  const auth = await requireCenterAdmin(req);
  if (!auth || auth.isModerator) return null;
  return auth;
}

export const forbidden = () => NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

/** Product row plus the "Notify me" count — the launch-demand signal. */
export const ADMIN_PRODUCT_SELECT = {
  ...PRODUCT_SELECT,
  _count: { select: { interests: true } },
} satisfies Prisma.MarketplaceProductSelect;

export type AdminProductRow = Prisma.MarketplaceProductGetPayload<{ select: typeof ADMIN_PRODUCT_SELECT }>;

export function toAdminProductView(row: AdminProductRow): MarketplaceProductAdminView {
  const { _count, ...rest } = row;
  return { ...toProductView(rest as ProductRow), interestCount: _count.interests };
}

/** Parse a JSON body, or return null (caller answers 400). */
export async function readJson(req: NextRequest): Promise<unknown | undefined> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}
