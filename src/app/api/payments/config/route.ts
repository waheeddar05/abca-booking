import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';
import { resolveCurrentCenter } from '@/lib/centers';
import { getCenterRazorpayCredentials } from '@/lib/razorpay';
import { getPolicyValue, isPolicyEnabled } from '@/lib/policy';

const ENV_RAZORPAY_PUBLIC_KEY = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID
  || process.env.RAZORPAY_KEY_ID
  || '';

// GET /api/payments/config - Payment config (includes cash payment eligibility)
// NOTE: Resolves per-center overrides so admin toggles take effect for the
// user's current center, not just globally.
export async function GET(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    const center = await resolveCurrentCenter(req, user);
    const centerId = center?.id ?? null;

    // All flags go through the center → global → default cascade.
    const [
      paymentEnabled,
      slotPaymentRequired,
      packagePaymentRequired,
      centerCashEnabled,
      walletEnabled,
      kitRentalRaw,
      ballTypeSelectionEnabled,
      pitchTypeSelectionEnabled,
    ] = await Promise.all([
      isPolicyEnabled('PAYMENT_GATEWAY_ENABLED', centerId),
      isPolicyEnabled('SLOT_PAYMENT_REQUIRED', centerId),
      isPolicyEnabled('PACKAGE_PAYMENT_REQUIRED', centerId),
      isPolicyEnabled('CASH_PAYMENT_ENABLED', centerId),
      isPolicyEnabled('WALLET_ENABLED', centerId),
      getPolicyValue('KIT_RENTAL_CONFIG', centerId, null),
      // Ball / pitch selector toggles. Resource-based centers expose
      // these as a center-wide override on top of the per-machine
      // supportedBallTypes / supportedPitchTypes lists. When the
      // toggle is OFF the user-side picker auto-selects the first
      // supported value and hides the chip row. Defaults to ON (true)
      // when the policy isn't set, matching the existing UI behaviour.
      isPolicyEnabled('BALL_TYPE_SELECTION_ENABLED', centerId, true),
      isPolicyEnabled('PITCH_TYPE_SELECTION_ENABLED', centerId, true),
    ]);

    // Check per-user cash payment override at the user's current center.
    // CashPaymentUser is center-scoped — a user may have cash access at
    // ABCA but not Toplay (or vice versa).
    let userHasCashAccess = false;
    let centerRazorpayKeyId: string | null = null;
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
      if (kitRentalRaw) {
        kitRentalConfig = { ...DEFAULT_KIT_RENTAL, ...JSON.parse(kitRentalRaw) };
      }
    } catch { /* use defaults */ }

    return NextResponse.json({
      paymentEnabled,
      slotPaymentRequired,
      packagePaymentRequired,
      // Per-center keyId when the center configured one; env fallback
      // otherwise. The client uses this to bootstrap the Razorpay
      // checkout for the right merchant account.
      razorpayKeyId: paymentEnabled
        ? (centerRazorpayKeyId || ENV_RAZORPAY_PUBLIC_KEY)
        : '',
      cashPaymentEnabled: centerCashEnabled || userHasCashAccess,
      walletEnabled,
      kitRentalConfig,
      // Selector visibility flags. Default true (selectors visible)
      // when nothing is configured; admins can flip to false in the
      // center configuration page to force-pick the first option.
      ballTypeSelectionEnabled,
      pitchTypeSelectionEnabled,
      centerId: center?.id ?? null,
    });
  } catch (error) {
    console.error('Payment config error:', error);
    return NextResponse.json({ error: 'Failed to fetch payment config' }, { status: 500 });
  }
}
