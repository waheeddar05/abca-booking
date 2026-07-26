/**
 * Payment reconciliation — the permanent safety net for "paid but no
 * booking" orphans.
 *
 * ─── Why this exists ────────────────────────────────────────────────
 * A captured Razorpay payment is turned into a confirmed booking by one
 * of two paths:
 *   1. the client-driven `/api/payments/verify` call, and
 *   2. the `/api/webhooks/razorpay` backstop.
 *
 * Both can fail to run:
 *   • verify never fires — the mobile app is backgrounded/killed right
 *     after payment, the network drops between Razorpay's callback and
 *     our server, or a JS error swallows the success handler. The money
 *     is taken but the booking is never requested. The Payment row is
 *     left in `CREATED` — invisible to the existing orphan tools, which
 *     only scan `CAPTURED`.
 *   • the webhook never arrives — not configured in the Razorpay
 *     dashboard, wrong URL, or a bad webhook secret.
 *
 * When BOTH miss, the customer has paid and has no booking, and nothing
 * in the system ever fixes it. This module closes that gap by treating
 * **Razorpay as the source of truth**: it periodically asks Razorpay
 * "was this order actually paid?" and, if so, runs the exact same
 * booking-creation code the verify/webhook paths use — idempotently and
 * race-safely: it takes the same fulfilment lease verify and the webhook
 * take (src/lib/payment-claim.ts), so it can never fulfil a payment that
 * another path is already fulfilling.
 *
 * Driven by:
 *   • `/api/cron/reconcile-payments`        — Vercel Cron, every few min
 *   • `/api/admin/payments/reconcile`       — super-admin manual trigger
 *     (also supports `?paymentId=` to recover one specific payment now)
 */
import { prisma } from './prisma';
import { fetchOrderPayments, type RazorpayOrderPaymentItem } from './razorpay';
import { markCaptureNeedsRecovery } from './payment-recovery';
import { completePackagePurchase } from './package-purchase';
import { log, type LogContext } from './logger';
import {
  claimCaptureAndBooking,
  claimBookingLease,
  releaseBookingLease,
  waitForFulfilment,
  newLeaseHolder,
  type FulfilmentKind,
} from './payment-claim';
import {
  executeResourceBooking,
  ResourceBookingBodySchema,
} from '@/app/api/slots/book-resource/route';

function superAdminEmail(): string {
  return process.env.SUPER_ADMIN_EMAIL || process.env.INITIAL_ADMIN_EMAIL || '';
}

// ─── Pure decision logic (unit-tested) ──────────────────────────────

export type ReconcileDecision =
  | { action: 'finalize'; razorpayPaymentId: string }
  | { action: 'skip_unpaid' }
  | { action: 'skip_done' };

/**
 * Given the local Payment row + the list of Razorpay payment attempts on
 * its order, decide what the reconciler should do. No DB, no network —
 * deterministic and unit-testable.
 */
export function decideReconcileAction(
  payment: {
    status: string;
    paymentType: string;
    bookingIds: string[];
    userPackageId: string | null;
    razorpayPaymentId: string | null;
  },
  orderPayments: { items?: RazorpayOrderPaymentItem[] } | null,
): ReconcileDecision {
  // Already terminal / already fulfilled → never touch.
  if (payment.status === 'REFUNDED') return { action: 'skip_done' };
  if (payment.status === 'FAILED') return { action: 'skip_done' };
  if (payment.paymentType === 'SLOT_BOOKING' && payment.bookingIds.length > 0) {
    return { action: 'skip_done' };
  }
  if (payment.paymentType === 'PACKAGE_PURCHASE' && payment.userPackageId) {
    return { action: 'skip_done' };
  }

  const captured = orderPayments?.items?.find((p) => p.status === 'captured');

  // Locally CAPTURED but unfulfilled → money is known to be in; finalize.
  if (payment.status === 'CAPTURED') {
    const rpId = payment.razorpayPaymentId || captured?.id;
    return rpId ? { action: 'finalize', razorpayPaymentId: rpId } : { action: 'skip_unpaid' };
  }

  // CREATED (or anything else non-terminal) → trust Razorpay.
  if (captured?.id) return { action: 'finalize', razorpayPaymentId: captured.id };
  return { action: 'skip_unpaid' };
}

// ─── Finalizer (claim → create booking/package, idempotent) ─────────

export type FinalizeResult =
  | 'booking_created'
  | 'package_completed'
  | 'already_done'
  | 'no_payload'
  | 'claim_lost'
  | 'failed';

export interface FinalizeOutcome {
  paymentId: string;
  result: FinalizeResult;
  bookingIds?: string[];
  error?: string;
}

/**
 * Turn a known-paid Payment into a confirmed booking/package.
 *
 * Holds the fulfilment lease for the whole run, so it can never
 * double-create against a concurrent verify / webhook / reconcile tick —
 * including one that arrives while this run is inside the booking
 * transaction, which is exactly the window that produced a customer
 * paying for 2 slots and receiving 4.
 */
async function finalizeCapturedPayment(
  paymentId: string,
  razorpayPaymentId: string,
  source: string,
): Promise<FinalizeOutcome> {
  const holder = newLeaseHolder(`reconcile/${source}`);
  // Bounded: the self-heal endpoint may scan several payments inside one
  // 30s request, so a contended payment must not eat the whole budget.
  // Giving up here is safe — it just means the next tick (or the user's
  // next visit) reports the result instead of this one.
  const WAIT_MS = 8_000;
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) return { paymentId, result: 'failed', error: 'payment vanished' };

  const ctx = {
    op: 'payment.reconcile',
    user: { id: payment.userId },
    centerId: payment.centerId,
    paymentId: payment.id,
    razorpayOrderId: payment.razorpayOrderId,
    razorpayPaymentId,
    amount: payment.amount,
    extra: { source, paymentType: payment.paymentType },
  } as const;

  // Already fulfilled by some other path between scan and now.
  if (payment.status === 'REFUNDED') return { paymentId, result: 'already_done' };
  if (payment.paymentType === 'SLOT_BOOKING' && payment.bookingIds.length > 0) {
    return { paymentId, result: 'already_done', bookingIds: payment.bookingIds };
  }
  if (payment.paymentType === 'PACKAGE_PURCHASE' && payment.userPackageId) {
    return { paymentId, result: 'already_done' };
  }

  const kind: FulfilmentKind =
    payment.paymentType === 'PACKAGE_PURCHASE' ? 'PACKAGE_PURCHASE' : 'SLOT_BOOKING';

  // ─── Claim ────────────────────────────────────────────────────────
  // Two things have to be true before we may run the booking engine:
  // the payment is ours to finalize, and nobody else is already
  // finalizing it. The capture flip alone only answered the first —
  // which is how two `recover-mine` calls 5s apart both booked the same
  // order (the second one arrived while the first was still inside its
  // booking transaction, saw CAPTURED-with-no-bookings, and treated it
  // as an orphan to rescue). The lease answers the second, and is held
  // until fulfilment finishes. See src/lib/payment-claim.ts.
  if (payment.status === 'CREATED') {
    const claim = await claimCaptureAndBooking({
      paymentId: payment.id,
      razorpayPaymentId,
      holder,
    });
    if (claim.outcome === 'lost') {
      // verify / webhook / another tick grabbed it and is fulfilling
      // now. Wait for their result rather than racing them.
      const fulfilled = await waitForFulfilment({ paymentId: payment.id, kind, timeoutMs: WAIT_MS });
      if (fulfilled) {
        return { paymentId, result: 'already_done', bookingIds: fulfilled.bookingIds };
      }
      log.info(ctx, 'Reconcile lost capture claim to another path — backing off');
      return { paymentId, result: 'claim_lost' };
    }
    log.info(ctx, 'Reconcile won capture claim + booking lease — finalizing orphaned payment');
  } else if (payment.status === 'CAPTURED') {
    if (!payment.razorpayPaymentId) {
      await prisma.payment
        .update({ where: { id: payment.id }, data: { razorpayPaymentId } })
        .catch((e) => log.error(ctx, 'Failed to backfill razorpayPaymentId', e));
    }
    // Already CAPTURED and unfulfilled. This is the state a genuine
    // orphan sits in — and *also* the state a payment being fulfilled
    // right now sits in. Only the lease tells them apart.
    const lease = await claimBookingLease({ paymentId: payment.id, kind, holder });
    if (lease.outcome === 'gone') {
      return { paymentId, result: 'failed', error: 'payment vanished' };
    }
    if (lease.outcome === 'already_fulfilled') {
      return { paymentId, result: 'already_done', bookingIds: lease.bookingIds };
    }
    if (lease.outcome === 'busy') {
      const fulfilled = await waitForFulfilment({ paymentId: payment.id, kind, timeoutMs: WAIT_MS });
      if (fulfilled) {
        return { paymentId, result: 'already_done', bookingIds: fulfilled.bookingIds };
      }
      log.info(
        { ...ctx, extra: { ...ctx.extra, heldBy: lease.heldBy } },
        'Reconcile found a live booking lease — backing off (another path is finalizing)',
      );
      return { paymentId, result: 'claim_lost' };
    }
    log.info(ctx, 'Reconcile took booking lease on captured orphan — finalizing');
  } else {
    return { paymentId, result: 'failed', error: `unexpected status ${payment.status}` };
  }

  try {
    return await fulfilClaimedPayment(payment, source, ctx);
  } finally {
    // Hand the lease back whatever happened. On success `bookingIds` is
    // already set so the lease is moot; on failure this lets the next
    // tick retry immediately instead of waiting out the expiry.
    await releaseBookingLease(payment.id, holder);
  }
}

type PaymentRow = NonNullable<Awaited<ReturnType<typeof prisma.payment.findUnique>>>;

/**
 * Create the bookings / complete the package for a payment whose
 * fulfilment lease we already hold. Split out from
 * `finalizeCapturedPayment` purely so the lease can be released in a
 * single `finally` regardless of which branch returns.
 */
async function fulfilClaimedPayment(
  payment: PaymentRow,
  source: string,
  ctx: LogContext,
): Promise<FinalizeOutcome> {
  const paymentId = payment.id;

  // Build the (lightweight) user the booking engine expects.
  const user = await prisma.user.findUnique({
    where: { id: payment.userId },
    select: {
      id: true, name: true, role: true, email: true,
      isFreeUser: true, isSpecialUser: true, mobileVerified: true,
    },
  });
  if (!user) {
    await markCaptureNeedsRecovery(payment.id, `[reconcile/${source}] payer user not found`).catch(() => {});
    return { paymentId, result: 'failed', error: 'user not found' };
  }
  const authedUser = {
    id: user.id,
    name: user.name || undefined,
    role: user.role,
    email: user.email || undefined,
    isSuperAdmin: !!(user.email && superAdminEmail() && user.email === superAdminEmail()),
    isFreeUser: user.isFreeUser,
    isSpecialUser: user.isSpecialUser,
    mobileVerified: user.mobileVerified,
  };

  // ── PACKAGE_PURCHASE ──
  if (payment.paymentType === 'PACKAGE_PURCHASE') {
    try {
      const res = await completePackagePurchase(
        { id: payment.id, amount: payment.amount, metadata: payment.metadata, centerId: payment.centerId },
        payment.userId,
      );
      log.info({ ...ctx, extra: { ...ctx.extra, userPackageId: res.userPackage.id } }, 'Reconcile completed package purchase');
      return { paymentId, result: 'package_completed' };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'package completion failed';
      log.error(ctx, 'Reconcile package completion failed', e);
      await markCaptureNeedsRecovery(payment.id, `[reconcile/${source}] ${msg}`).catch(() => {});
      return { paymentId, result: 'failed', error: msg };
    }
  }

  // ── SLOT_BOOKING ──
  const meta = (payment.metadata && typeof payment.metadata === 'object'
    ? payment.metadata
    : {}) as Record<string, unknown>;
  const bookingPayload = meta.bookingPayload as Record<string, unknown>[] | undefined;
  if (!bookingPayload || bookingPayload.length === 0) {
    log.error(ctx, 'Reconcile: captured payment has no bookingPayload — flagging for manual recovery');
    await markCaptureNeedsRecovery(payment.id, `[reconcile/${source}] captured but bookingPayload missing`).catch(() => {});
    return { paymentId, result: 'no_payload' };
  }

  const center = await prisma.center.findUnique({
    where: { id: payment.centerId },
    select: { id: true, name: true, bookingModel: true },
  });
  if (!center) {
    await markCaptureNeedsRecovery(payment.id, `[reconcile/${source}] center missing`).catch(() => {});
    return { paymentId, result: 'failed', error: 'center not found' };
  }

  try {
    if (center.bookingModel === 'RESOURCE_BASED') {
      const parsed = ResourceBookingBodySchema.safeParse(bookingPayload[0]);
      if (!parsed.success) {
        await markCaptureNeedsRecovery(payment.id, `[reconcile/${source}] invalid resource payload`).catch(() => {});
        return { paymentId, result: 'failed', error: 'invalid resource payload' };
      }
      const bookings = await executeResourceBooking(authedUser, parsed.data, center, {
        onlinePaymentId: payment.id,
      });
      await prisma.payment
        .update({ where: { id: payment.id }, data: { bookingIds: bookings.map((b) => b.id) } })
        .catch((e) => log.error(ctx, 'Failed to link bookingIds', e));
      log.info({ ...ctx, bookingIds: bookings.map((b) => b.id) }, 'Reconcile created resource booking(s)');
      return { paymentId, result: 'booking_created', bookingIds: bookings.map((b) => b.id) };
    }

    // All centers use the resource-based model; the legacy
    // executeSlotBooking engine has been removed. A non-resource center
    // here is a misconfiguration — flag for manual recovery rather than
    // booking via the removed legacy path.
    await markCaptureNeedsRecovery(
      payment.id,
      `[reconcile/${source}] unsupported booking model ${center.bookingModel}`,
    ).catch(() => {});
    return { paymentId, result: 'failed', error: `unsupported booking model ${center.bookingModel}` };
  } catch (e) {
    // executeSlotBooking auto-refunds to wallet on a genuine booking
    // failure (slot gone, etc.); we just record the outcome here.
    const msg = e instanceof Error ? e.message : 'booking failed';
    log.error(ctx, 'Reconcile booking creation failed', e);
    await markCaptureNeedsRecovery(payment.id, `[reconcile/${source}] ${msg}`).catch(() => {});
    return { paymentId, result: 'failed', error: msg };
  }
}

// ─── Scanner ────────────────────────────────────────────────────────

export interface ReconcileOptions {
  /** Only consider payments older than this — give the normal flow time
   *  to finish first. Default 3 minutes. Set 0 for targeted recovery. */
  minAgeMs?: number;
  /** Ignore payments older than this (Razorpay orders expire; very old
   *  abandoned ones aren't worth checking). Default 3 days. */
  maxAgeMs?: number;
  /** Max payments to process per run. Default 40. */
  limit?: number;
  /** Reconcile one specific payment id (manual targeted recovery). */
  paymentId?: string;
  /** Scope the scan to a single user's payments (self-heal endpoint). */
  userId?: string;
  /** Tag for logs: 'cron' | 'manual' | 'self' | 'targeted'. */
  source?: string;
}

export interface ReconcileSummary {
  scanned: number;
  finalizedBookings: number;
  finalizedPackages: number;
  alreadyDone: number;
  unpaid: number;
  noPayload: number;
  failed: number;
  outcomes: FinalizeOutcome[];
}

/**
 * Find unfinalized payments, check each against Razorpay, and finalize
 * the ones that were actually paid.
 */
export async function reconcileStalePayments(opts: ReconcileOptions = {}): Promise<ReconcileSummary> {
  const minAgeMs = opts.minAgeMs ?? 3 * 60_000;
  const maxAgeMs = opts.maxAgeMs ?? 3 * 24 * 60 * 60_000;
  const limit = opts.limit ?? 40;
  const source = opts.source ?? 'cron';

  const now = Date.now();
  const newerThan = new Date(now - maxAgeMs);
  const olderThan = new Date(now - minAgeMs);

  const candidates = opts.paymentId
    ? await prisma.payment.findMany({ where: { id: opts.paymentId } })
    : await prisma.payment.findMany({
        where: {
          paymentType: { in: ['SLOT_BOOKING', 'PACKAGE_PURCHASE'] },
          createdAt: { gte: newerThan, lte: olderThan },
          ...(opts.userId ? { userId: opts.userId } : {}),
          OR: [
            { status: 'CREATED' },
            { status: 'CAPTURED', paymentType: 'SLOT_BOOKING', bookingIds: { isEmpty: true } },
            { status: 'CAPTURED', paymentType: 'PACKAGE_PURCHASE', userPackageId: null },
          ],
        },
        orderBy: { createdAt: 'asc' },
        take: limit,
      });

  const summary: ReconcileSummary = {
    scanned: candidates.length,
    finalizedBookings: 0,
    finalizedPackages: 0,
    alreadyDone: 0,
    unpaid: 0,
    noPayload: 0,
    failed: 0,
    outcomes: [],
  };

  for (const payment of candidates) {
    try {
      if (!payment.razorpayOrderId) {
        summary.failed++;
        summary.outcomes.push({ paymentId: payment.id, result: 'failed', error: 'no razorpayOrderId' });
        continue;
      }

      // Short-circuit: a locally-CAPTURED orphan with a known rp payment
      // id is already proven paid — no need to call Razorpay again.
      let decision: ReconcileDecision;
      const locallyKnownPaid =
        payment.status === 'CAPTURED' &&
        !!payment.razorpayPaymentId &&
        ((payment.paymentType === 'SLOT_BOOKING' && payment.bookingIds.length === 0) ||
          (payment.paymentType === 'PACKAGE_PURCHASE' && !payment.userPackageId));

      if (locallyKnownPaid) {
        decision = { action: 'finalize', razorpayPaymentId: payment.razorpayPaymentId! };
      } else {
        let orderPayments: { items?: RazorpayOrderPaymentItem[] } | null = null;
        try {
          orderPayments = await fetchOrderPayments(payment.centerId, payment.razorpayOrderId);
        } catch (e) {
          log.error(
            { op: 'payment.reconcile', paymentId: payment.id, centerId: payment.centerId },
            'fetchOrderPayments failed',
            e,
          );
          summary.failed++;
          summary.outcomes.push({ paymentId: payment.id, result: 'failed', error: 'razorpay fetch failed' });
          continue;
        }
        decision = decideReconcileAction(payment, orderPayments);
      }

      if (decision.action === 'skip_unpaid') {
        summary.unpaid++;
        continue;
      }
      if (decision.action === 'skip_done') {
        summary.alreadyDone++;
        continue;
      }

      const outcome = await finalizeCapturedPayment(payment.id, decision.razorpayPaymentId, source);
      summary.outcomes.push(outcome);
      switch (outcome.result) {
        case 'booking_created': summary.finalizedBookings++; break;
        case 'package_completed': summary.finalizedPackages++; break;
        case 'already_done': summary.alreadyDone++; break;
        case 'no_payload': summary.noPayload++; break;
        default: summary.failed++; break;
      }
    } catch (e) {
      log.error({ op: 'payment.reconcile', paymentId: payment.id }, 'Reconcile candidate crashed', e);
      summary.failed++;
    }
  }

  if (summary.scanned > 0) {
    log.info(
      { op: 'payment.reconcile', extra: { source, ...summary, outcomes: undefined } },
      `Reconcile(${source}): scanned=${summary.scanned} bookings=${summary.finalizedBookings} ` +
        `packages=${summary.finalizedPackages} alreadyDone=${summary.alreadyDone} ` +
        `unpaid=${summary.unpaid} noPayload=${summary.noPayload} failed=${summary.failed}`,
    );
  }
  return summary;
}
