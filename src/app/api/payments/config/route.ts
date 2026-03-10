import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';

const RAZORPAY_PUBLIC_KEY = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID
  || process.env.RAZORPAY_KEY_ID
  || '';

const PAYMENT_POLICY_KEYS = [
  'PAYMENT_GATEWAY_ENABLED',
  'SLOT_PAYMENT_REQUIRED',
  'PACKAGE_PAYMENT_REQUIRED',
  'CASH_PAYMENT_ENABLED',
  'WALLET_ENABLED',
];

// GET /api/payments/config - Payment config (includes cash payment eligibility)
// NOTE: Queries DB directly (no cache) so admin changes take effect immediately.
export async function GET(req: NextRequest) {
  try {
    // Parallelize: fetch policies from DB directly and authenticate user
    const [policies, user] = await Promise.all([
      prisma.policy.findMany({ where: { key: { in: PAYMENT_POLICY_KEYS } } }),
      getAuthenticatedUser(req),
    ]);

    const config: Record<string, string> = {};
    for (const p of policies) config[p.key] = p.value;

    const globalCashEnabled = config['CASH_PAYMENT_ENABLED'] === 'true';

    // Check per-user cash payment override
    let userHasCashAccess = false;
    if (user) {
      const cashPaymentUser = await prisma.cashPaymentUser.findUnique({
        where: { userId: user.id },
      });
      userHasCashAccess = !!cashPaymentUser;
    }

    const paymentEnabled = config['PAYMENT_GATEWAY_ENABLED'] === 'true';

    return NextResponse.json({
      paymentEnabled,
      slotPaymentRequired: config['SLOT_PAYMENT_REQUIRED'] === 'true',
      packagePaymentRequired: config['PACKAGE_PAYMENT_REQUIRED'] === 'true',
      razorpayKeyId: paymentEnabled ? RAZORPAY_PUBLIC_KEY : '',
      cashPaymentEnabled: globalCashEnabled || userHasCashAccess,
      walletEnabled: config['WALLET_ENABLED'] === 'true',
    });
  } catch (error) {
    console.error('Payment config error:', error);
    return NextResponse.json({ error: 'Failed to fetch payment config' }, { status: 500 });
  }
}
