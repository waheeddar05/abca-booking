import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sanitizeApiError } from '@/lib/api-errors';
import { invalidatePolicy } from '@/lib/policy';
import { invalidatePolicyCache } from '@/lib/policy-cache';
import { MARKETPLACE_POLICY_KEY, MarketplaceConfigSchema } from '@/lib/marketplace';
import { getMarketplaceConfig, resolveEnquiryPhone } from '@/lib/marketplace-server';
import { forbidden, readJson, requireShopAdmin } from '../shared';

/**
 * Store launch settings for the current center — the MARKETPLACE_CONFIG
 * policy behind "Coming soon".
 *
 *   GET /api/admin/shop/settings   resolved config (center → global → default)
 *   PUT /api/admin/shop/settings   write the center override
 *
 * Writes go to CenterPolicy(currentCenter, MARKETPLACE_CONFIG), exactly
 * like a Save on Admin → Configuration, and invalidate the policy cache
 * so /shop picks the change up immediately.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireShopAdmin(req);
    if (!auth) return forbidden();
    const config = await getMarketplaceConfig(auth.center.id);
    return NextResponse.json({
      config,
      enquiryPhone: resolveEnquiryPhone(config, auth.center),
      // What the shop uses when the store's own number is blank — the
      // center's contact list, resolved the same way the shop does it, so
      // the settings card previews the real fallback rather than guessing
      // from the single legacy contactPhone column.
      fallbackEnquiryPhone: resolveEnquiryPhone({ ...config, enquiryPhone: '' }, auth.center),
      centerContactPhone: auth.center.contactPhone,
    });
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
    await prisma.centerPolicy.upsert({
      where: { centerId_key: { centerId: auth.center.id, key: MARKETPLACE_POLICY_KEY } },
      update: { value },
      create: { centerId: auth.center.id, key: MARKETPLACE_POLICY_KEY, value },
    });
    invalidatePolicy(MARKETPLACE_POLICY_KEY, auth.center.id);
    invalidatePolicyCache(MARKETPLACE_POLICY_KEY);

    const config = await getMarketplaceConfig(auth.center.id);
    return NextResponse.json({ config, enquiryPhone: resolveEnquiryPhone(config, auth.center) });
  } catch (error) {
    const { message, status } = sanitizeApiError(error, 'admin.shop.settings.put');
    return NextResponse.json({ error: message }, { status });
  }
}
