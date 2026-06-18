import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/adminAuth';
import { reconcileStalePayments } from '@/lib/payment-reconcile';
import { sanitizeApiError } from '@/lib/api-errors';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/admin/payments/reconcile
 *
 * Super-admin manual trigger for the payment reconciler. Use during an
 * incident, or to recover a specific orphaned payment immediately when a
 * customer reports "I paid but I have no booking".
 *
 *   ?paymentId=<id>   — reconcile just this payment now (ignores age).
 *   ?minAgeMin=0      — override the settle window (default 0 for manual).
 *   ?limit=50         — cap how many to process in one run.
 *
 * Unlike the existing orphan tools, this also recovers payments still in
 * CREATED state (verify never ran) by asking Razorpay whether the order
 * was actually paid.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireSuperAdmin(req);
    if (!session) {
      return NextResponse.json({ error: 'Super admin required' }, { status: 403 });
    }

    const url = new URL(req.url);
    const paymentId = url.searchParams.get('paymentId') || undefined;
    const minAgeMin = url.searchParams.get('minAgeMin');
    const limit = url.searchParams.get('limit');

    const summary = await reconcileStalePayments({
      source: paymentId ? 'targeted' : 'manual',
      paymentId,
      minAgeMs: minAgeMin ? Math.max(0, parseInt(minAgeMin, 10)) * 60_000 : 0,
      limit: limit ? Math.max(1, parseInt(limit, 10)) : 50,
    });

    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    const { message, status } = sanitizeApiError(
      error,
      'admin.payments.reconcile',
      'Could not run payment reconciliation.',
    );
    return NextResponse.json({ error: message }, { status });
  }
}
