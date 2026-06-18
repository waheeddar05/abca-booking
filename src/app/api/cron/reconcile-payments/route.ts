import { NextRequest, NextResponse } from 'next/server';
import { reconcileStalePayments } from '@/lib/payment-reconcile';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/cron/reconcile-payments
 *
 * Scheduled safety net (Vercel Cron). Finds payments that were taken by
 * Razorpay but never turned into a booking — because neither the client
 * `verify` call nor the webhook ran — and finalizes them.
 *
 * Auth: Vercel Cron automatically sends `Authorization: Bearer
 * <CRON_SECRET>` when the CRON_SECRET project env var is set. We also
 * accept the same secret via `x-cron-secret` for manual curl triggers
 * during an incident. Without a valid secret the route 401s, so it can
 * never be abused by the public.
 *
 * Schedule lives in vercel.json. Daily by default (safe on every Vercel
 * plan); bump to a 5-minute schedule on Pro for near-real-time recovery.
 */
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed if not configured
  const auth = req.headers.get('authorization');
  if (auth === `Bearer ${secret}`) return true;
  if (req.headers.get('x-cron-secret') === secret) return true;
  return false;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const url = new URL(req.url);
    const minAgeMin = url.searchParams.get('minAgeMin');
    const limit = url.searchParams.get('limit');
    const summary = await reconcileStalePayments({
      source: 'cron',
      minAgeMs: minAgeMin ? Math.max(0, parseInt(minAgeMin, 10)) * 60_000 : undefined,
      limit: limit ? Math.max(1, parseInt(limit, 10)) : 25,
    });
    // Drop the per-payment outcomes from the response body to keep it small;
    // the full detail is in the structured logs.
    return NextResponse.json({ ok: true, summary: { ...summary, outcomes: undefined } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'reconcile failed';
    console.error('[cron/reconcile-payments] failed:', e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
