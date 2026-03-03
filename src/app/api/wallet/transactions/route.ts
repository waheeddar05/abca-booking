import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth';
import { getWalletTransactions, isWalletEnabled } from '@/lib/wallet';

/**
 * GET /api/wallet/transactions — Get wallet transaction history
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

    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);

    const result = await getWalletTransactions(user.id, page, limit);

    return NextResponse.json(result);
  } catch (error) {
    console.error('Wallet transactions GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
