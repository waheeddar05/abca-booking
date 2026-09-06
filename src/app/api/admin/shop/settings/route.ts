import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sanitizeApiError } from '@/lib/api-errors';
import { invalidatePolicy } from '@/lib/policy';
import { invalidatePolicyCache } from '@/lib/policy-cache';
import { MARKETPLACE_POLICY_KEY, MarketplaceConfigSchema } from '@/lib/marketplace';
import { getMarketplaceConfig, resolveEnquiryPhone } from '@/lib/marketplace-server';
import { forbidden, readJson, requireShopAdmin } from '../shared';

/**
 * Cricket Store launch settings — the MARKETPLACE_CONFIG policy behind
 * "Coming soon", the pickup note and the enquiry number.
 *
 *   GET /api/admin/shop/settings   resolved config (global → default)
 *   PUT /api/admin/shop/settings   write it
 *
 * The store is one catalog for all of PlayOrbit, so this is the **global**
 * `Policy` row — never a `CenterPolicy` — and the cache is invalidated for
 * every center so /shop picks the change up immediately.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireShopAdmin(req);
    if (!auth) return forbidden();
    const config = await getMarketplaceConfig();
    return NextResponse.json({ config, enquiryPhone: resolveEnquiryPhone(config) });
  } catch (error) {
    const { message, status } = sanitizeApiError(error, 'admin.shop.settings.get');
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const auth = await requireShopAdmin(req);
    if (!auth) return forbidden();

    const body = await readJson(req);
    if (body === undefined) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    const parsed = MarketplaceConfigSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Validation failed' },
        { status: 400 },
      );
    }

    const value = JSON.stringify(parsed.data);
    await prisma.policy.upsert({
      where: { key: MARKETPLACE_POLICY_KEY },
      update: { value },
      create: { key: MARKETPLACE_POLICY_KEY, value },
    });
    // Every cached variant of the key (global and any per-center reads).
    invalidatePolicy(MARKETPLACE_POLICY_KEY);
    invalidatePolicyCache(MARKETPLACE_POLICY_KEY);

    const config = await getMarketplaceConfig();
    return NextResponse.json({ config, enquiryPhone: resolveEnquiryPhone(config) });
  } catch (error) {
    const { message, status } = sanitizeApiError(error, 'admin.shop.settings.put');
    return NextResponse.json({ error: message }, { status });
  }
}
