import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';
import { getCachedPolicies } from '@/lib/policy-cache';

const RAZORPAY_PUBLIC_KEY = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID
  || process.env.RAZORPAY_KEY_ID
  || '';

// GET /api/payments/config - Payment config (includes cash payment eligibility)
export async function GET(req: NextRequest) {
  try {
    // Parallelize: fetch policies (cached) and authenticate user at the same time
    const [config, user] = await Promise.all([
      getCachedPolicies([
        'PAYMENT_GATEWAY_ENABLED',
        'SLOT_PAYMENT_REQUIRED',
        'PACKAGE_PAYMENT_REQUIRED',
        'CASH_PAYMENT_ENABLED',
      ]),
      getAuthenticatedUser(req),
    ]);

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
    });
  } catch (error) {
    console.error('Payment config error:', error);
    return NextResponse.json({ error: 'Failed to fetch payment config' }, { status: 500 });
  }
}
