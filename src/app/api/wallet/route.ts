import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth';
import { getOrCreateWallet, isWalletEnabled } from '@/lib/wallet';

/**
 * GET /api/wallet — Get wallet balance
 */
export async function GET(req: NextRequest) {
  try {
    // Parallelize auth check and feature flag check
    const [user, enabled] = await Promise.all([
      getAuthenticatedUser(req),
      isWalletEnabled(),
    ]);

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!enabled) {
      return NextResponse.json({ error: 'Wallet feature is not enabled' }, { status: 403 });
    }

    const wallet = await getOrCreateWallet(user.id);

    return NextResponse.json({
      balance: wallet.balance,
      walletId: wallet.id,
    });
  } catch (error) {
    console.error('Wallet GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
