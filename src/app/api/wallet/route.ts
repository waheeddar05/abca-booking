import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth';
import { resolveCurrentCenter } from '@/lib/centers';
import { getOrCreateWallet, isWalletEnabled } from '@/lib/wallet';

/**
 * GET /api/wallet — Get wallet balance for the user at the current center.
 *
 * Wallets are center-scoped. The current center is resolved from the
 * `?center=<slug>` query param, the `selectedCenterId` cookie, or the
 * user's first membership (see `src/lib/centers.ts`).
 */
export async function GET(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const center = await resolveCurrentCenter(req, user);
    if (!center) {
      return NextResponse.json({ error: 'No center selected' }, { status: 400 });
    }

    const enabled = await isWalletEnabled(center.id);
    if (!enabled) {
      return NextResponse.json({ error: 'Wallet feature is not enabled' }, { status: 403 });
    }

    const wallet = await getOrCreateWallet(user.id, center.id);

    return NextResponse.json({
      balance: wallet.balance,
      walletId: wallet.id,
      centerId: center.id,
      centerSlug: center.slug,
    });
  } catch (error) {
    console.error('Wallet GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
