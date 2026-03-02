import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';

// GET /api/payments/config - Payment config (includes cash payment eligibility)
export async function GET(req: NextRequest) {
  try {
    const policies = await prisma.policy.findMany({
      where: {
        key: {
          in: [
            'PAYMENT_GATEWAY_ENABLED',
            'SLOT_PAYMENT_REQUIRED',
            'PACKAGE_PAYMENT_REQUIRED',
            'CASH_PAYMENT_ENABLED',
          ],
        },
      },
    });

    const config: Record<string, string> = {};
    for (const p of policies) config[p.key] = p.value;

    const globalCashEnabled = config['CASH_PAYMENT_ENABLED'] === 'true';

    // Check per-user cash payment override
    let userHasCashAccess = false;
    const user = await getAuthenticatedUser(req);
    if (user) {
      const cashPaymentUser = await prisma.cashPaymentUser.findUnique({
        where: { userId: user.id },
      });
      userHasCashAccess = !!cashPaymentUser;
    }

    return NextResponse.json({
      paymentEnabled: config['PAYMENT_GATEWAY_ENABLED'] === 'true',
      slotPaymentRequired: config['SLOT_PAYMENT_REQUIRED'] === 'true',
      packagePaymentRequired: config['PACKAGE_PAYMENT_REQUIRED'] === 'true',
      razorpayKeyId: config['PAYMENT_GATEWAY_ENABLED'] === 'true'
        ? process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || ''
        : '',
      cashPaymentEnabled: globalCashEnabled || userHasCashAccess,
    });
  } catch (error) {
    console.error('Payment config error:', error);
    return NextResponse.json({ error: 'Failed to fetch payment config' }, { status: 500 });
  }
}
