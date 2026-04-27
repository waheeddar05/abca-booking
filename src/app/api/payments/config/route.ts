import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';
import { resolveCurrentCenter } from '@/lib/centers';
import { getCenterRazorpayCredentials } from '@/lib/razorpay';

const ENV_RAZORPAY_PUBLIC_KEY = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID
  || process.env.RAZORPAY_KEY_ID
  || '';

const PAYMENT_POLICY_KEYS = [
  'PAYMENT_GATEWAY_ENABLED',
  'SLOT_PAYMENT_REQUIRED',
  'PACKAGE_PAYMENT_REQUIRED',
  'CASH_PAYMENT_ENABLED',
  'WALLET_ENABLED',
  'KIT_RENTAL_CONFIG',
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

    // Check per-user cash payment override at the user's current center.
    // CashPaymentUser is center-scoped — a user may have cash access at
    // ABCA but not Toplay (or vice versa).
    let userHasCashAccess = false;
    let centerRazorpayKeyId: string | null = null;
    const center = await resolveCurrentCenter(req, user);
    if (center) {
      // Resolve which Razorpay account the client should initialize against.
      // This may be the center's own keyId or the env fallback. The secret
      // never leaves the server.
      const creds = await getCenterRazorpayCredentials(center.id);
      centerRazorpayKeyId = creds?.keyId ?? null;

      if (user) {
        const cashPaymentUser = await prisma.cashPaymentUser.findUnique({
          where: { centerId_userId: { centerId: center.id, userId: user.id } },
        });
        userHasCashAccess = !!cashPaymentUser;
      }
    }

    const paymentEnabled = config['PAYMENT_GATEWAY_ENABLED'] === 'true';

    // Parse kit rental config
    const DEFAULT_KIT_RENTAL = {
      enabled: false,
      price: 200,
      title: 'Cricket Kit & Bat Rental',
      description: 'Rent cricket kit and bat for your session',
      note: 'Any damages to the bat will be chargeable',
      machines: ['GRAVITY', 'YANTRA'],
    };
    let kitRentalConfig = DEFAULT_KIT_RENTAL;
    try {
      if (config['KIT_RENTAL_CONFIG']) {
        kitRentalConfig = { ...DEFAULT_KIT_RENTAL, ...JSON.parse(config['KIT_RENTAL_CONFIG']) };
      }
    } catch { /* use defaults */ }

    return NextResponse.json({
      paymentEnabled,
      slotPaymentRequired: config['SLOT_PAYMENT_REQUIRED'] === 'true',
      packagePaymentRequired: config['PACKAGE_PAYMENT_REQUIRED'] === 'true',
      // Per-center keyId when the center configured one; env fallback
      // otherwise. The client uses this to bootstrap the Razorpay
      // checkout for the right merchant account.
      razorpayKeyId: paymentEnabled
        ? (centerRazorpayKeyId || ENV_RAZORPAY_PUBLIC_KEY)
        : '',
      cashPaymentEnabled: globalCashEnabled || userHasCashAccess,
      walletEnabled: config['WALLET_ENABLED'] === 'true',
      kitRentalConfig,
      centerId: center?.id ?? null,
    });
  } catch (error) {
    console.error('Payment config error:', error);
    return NextResponse.json({ error: 'Failed to fetch payment config' }, { status: 500 });
  }
}
