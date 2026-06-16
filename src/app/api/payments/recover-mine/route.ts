import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth';
import { reconcileStalePayments } from '@/lib/payment-reconcile';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * GET /api/payments/recover-mine
 *
 * Self-heal: reconcile the *current user's own* recent unfinalized
 * payments against Razorpay. Called when the user opens "My Bookings",
 * so a payment where the client `verify` call never landed (app
 * backgrounded, network drop on mobile, etc.) gets turned into a real
 * booking the moment the customer comes back to check — with no admin,
 * cron, or webhook involved.
 *
 * Cheap when there's nothing to do (no candidate payments → zero
 * Razorpay calls). Safe to call repeatedly: the reconciler uses the
 * same atomic CREATED→CAPTURED claim as verify/webhook plus the DB slot
 * uniqueness constraint, so it can never double-book against an
 * in-flight verify.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const summary = await reconcileStalePayments({
      source: 'self',
      userId: user.id,
      minAgeMs: 0, // act immediately for the user in front of us
      maxAgeMs: 24 * 60 * 60 * 1000, // only this-day payments
      limit: 5,
    });

    return NextResponse.json({
      ok: true,
      recovered: summary.finalizedBookings + summary.finalizedPackages,
      bookingsCreated: summary.finalizedBookings,
    });
  } catch (e) {
    // Best-effort: never break the bookings page on a reconcile hiccup.
    const msg = e instanceof Error ? e.message : 'reconcile failed';
    console.error('[payments/recover-mine] failed:', e);
    return NextResponse.json({ ok: false, recovered: 0, error: msg }, { status: 200 });
  }
}
