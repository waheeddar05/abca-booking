import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth';
import { resolveCurrentCenter } from '@/lib/centers';
import { getWalletTransactions, isWalletEnabled } from '@/lib/wallet';

/**
 * GET /api/wallet/transactions — Wallet transaction history at the
 * current center. Wallets are center-scoped.
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

    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);

    const result = await getWalletTransactions(user.id, center.id, page, limit);

    return NextResponse.json(result);
  } catch (error) {
    console.error('Wallet transactions GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
