/**
 * Payment fulfilment lease — the single guard that stops a captured
 * payment from being turned into bookings more than once.
 *
 * ─── Why this exists ────────────────────────────────────────────────
 * Three independent paths can fulfil a captured Razorpay payment:
 *   1. `/api/payments/verify`        — client-driven, right after checkout
 *   2. `/api/webhooks/razorpay`      — Razorpay's server-to-server backstop
 *   3. `reconcileStalePayments()`    — cron + the `/api/payments/recover-mine`
 *                                      self-heal the bookings page fires
 *
 * They used to coordinate through a single atomic `CREATED → CAPTURED`
 * flip: whoever won the flip owned booking creation. That guard has a
 * hole big enough to drive a duplicate booking through, because the
 * *state it leaves behind* — `status=CAPTURED` with `bookingIds=[]` — is
 * indistinguishable from the orphan state every recovery path is
 * explicitly built to repair. For the several seconds the booking
 * transaction runs, the winner looks exactly like a payment that needs
 * rescuing, so a second path picks it up and books it all over again.
 *
 * Observed in production (2026-07-26): two `recover-mine` calls 5s apart
 * on the same order. The first flipped CREATED→CAPTURED and started
 * booking; the second saw CAPTURED-with-no-bookings, took the
 * "locally known paid" short-circuit, and booked a second time. The
 * customer paid for 2 slots and got 4.
 *
 * ─── The fix ────────────────────────────────────────────────────────
 * Extend the claim so it covers the *whole* fulfilment window instead of
 * just the status flip:
 *
 *   • `claimCaptureAndBooking()` — takes the capture flip AND the lease
 *     in one atomic UPDATE, so there is no instant where a payment is
 *     CAPTURED, unfulfilled, and unclaimed.
 *   • `claimBookingLease()` — for a payment that is already CAPTURED
 *     (genuine orphan, or one whose holder died). Wins only if nobody
 *     holds a live lease and the payment isn't already fulfilled.
 *   • `releaseBookingLease()` — hand it back when fulfilment ends.
 *   • `waitForFulfilment()` — what a loser does instead of booking:
 *     poll until the winner links its bookings, exactly as
 *     `/api/payments/verify` already did for the flip race.
 *
 * Leases expire (`BOOKING_LEASE_MS`) so a crashed or timed-out holder
 * can never wedge a payment permanently — the next reconcile tick steals
 * the lease and finishes the job.
 *
 * This is the *outer* guard. `executeResourceBookingCore` carries an
 * inner one: it re-reads the Payment row inside its serializable
 * transaction and refuses to create bookings for a payment that already
 * has some, then links `bookingIds` in that same transaction. Either
 * layer alone prevents the duplicate; together they also cover paths
 * that forget to take a lease.
 */
import { prisma } from './prisma';
import { log } from './logger';

/**
 * How long a fulfilment lease is honoured before another path may steal
 * it. Must comfortably exceed the worst-case booking transaction: the
 * serializable tx alone is allowed 15s and is retried up to 3 times, so
 * 90s leaves room for a slow, contended, retrying booking without ever
 * letting a genuinely dead holder block recovery for long.
 */
export const BOOKING_LEASE_MS = 90_000;

export type FulfilmentKind = 'SLOT_BOOKING' | 'PACKAGE_PURCHASE';

/**
 * Build the token a caller identifies its lease with, e.g.
 * `reconcile/self#3f9c1a`.
 *
 * The random suffix matters: `releaseBookingLease` only clears a lease
 * whose holder matches, and two concurrent runs of the *same* path
 * (two `recover-mine` calls, two cron ticks) would otherwise share a
 * token — letting the one that lost the race release the winner's lease
 * and re-open the very window this module closes.
 */
export function newLeaseHolder(path: string): string {
  return `${path}#${Math.random().toString(36).slice(2, 8)}`;
}

/** The subset of a Payment row this module reasons about. */
export interface FulfilmentState {
  status: string;
  bookingIds: string[];
  userPackageId: string | null;
}

/**
 * Has this payment already been turned into what it paid for? A refund
 * counts as terminal too — there is nothing left to create.
 */
export function isFulfilled(payment: FulfilmentState, kind: FulfilmentKind): boolean {
  if (payment.status === 'REFUNDED') return true;
  return kind === 'PACKAGE_PURCHASE'
    ? !!payment.userPackageId
    : payment.bookingIds.length > 0;
}

/** Prisma `where` fragment matching only not-yet-fulfilled payments. */
function unfulfilledWhere(kind: FulfilmentKind) {
  return kind === 'PACKAGE_PURCHASE'
    ? { userPackageId: null }
    : { bookingIds: { isEmpty: true } };
}

/** Prisma `where` fragment matching a lease that is free or expired. */
function leaseAvailableWhere(now: Date) {
  return {
    OR: [
      { bookingClaimAt: null },
      { bookingClaimAt: { lt: new Date(now.getTime() - BOOKING_LEASE_MS) } },
    ],
  };
}

export type CaptureClaimResult =
  /** We flipped CREATED→CAPTURED and hold the lease. Go create the bookings. */
  | { outcome: 'won' }
  /** Someone else flipped it first. Do NOT book — wait for their result. */
  | { outcome: 'lost' };

/**
 * Atomically flip `CREATED → CAPTURED` **and** take the fulfilment lease.
 *
 * Doing both in a single UPDATE is the point: if the lease were a second
 * statement, another path could observe the CAPTURED-and-unclaimed state
 * in between and start booking. Exactly one caller gets `won`.
 */
export async function claimCaptureAndBooking(params: {
  paymentId: string;
  razorpayPaymentId: string;
  razorpaySignature?: string;
  /** Which path is claiming — 'verify' | 'webhook' | 'reconcile/cron' | … */
  holder: string;
}): Promise<CaptureClaimResult> {
  const claim = await prisma.payment.updateMany({
    where: { id: params.paymentId, status: 'CREATED' },
    data: {
      status: 'CAPTURED',
      razorpayPaymentId: params.razorpayPaymentId,
      ...(params.razorpaySignature ? { razorpaySignature: params.razorpaySignature } : {}),
      bookingClaimAt: new Date(),
      bookingClaimBy: params.holder,
    },
  });
  return { outcome: claim.count === 1 ? 'won' : 'lost' };
}

export type BookingLeaseResult =
  /** The lease is ours. Create the bookings, then release it. */
  | { outcome: 'won' }
  /** Nothing to do — another path already created the bookings/package. */
  | { outcome: 'already_fulfilled'; bookingIds: string[]; userPackageId: string | null }
  /** Another path holds a live lease and is mid-fulfilment. Wait, don't book. */
  | { outcome: 'busy'; heldBy: string | null; heldSince: Date | null }
  /** The payment row disappeared. */
  | { outcome: 'gone' };

/**
 * Take the fulfilment lease on a payment that is already `CAPTURED`.
 *
 * This is the guard the old code was missing entirely: it used to walk
 * straight from "status is CAPTURED and bookingIds is empty" into the
 * booking engine, with nothing stopping a second path from doing the
 * same thing at the same time.
 */
export async function claimBookingLease(params: {
  paymentId: string;
  kind: FulfilmentKind;
  holder: string;
}): Promise<BookingLeaseResult> {
  const now = new Date();
  const claim = await prisma.payment.updateMany({
    where: {
      id: params.paymentId,
      status: 'CAPTURED',
      ...unfulfilledWhere(params.kind),
      ...leaseAvailableWhere(now),
    },
    data: { bookingClaimAt: now, bookingClaimBy: params.holder },
  });
  if (claim.count === 1) return { outcome: 'won' };

  // Lost — work out why so the caller can either stop (already done) or
  // wait for the holder (busy).
  const fresh = await prisma.payment.findUnique({
    where: { id: params.paymentId },
    select: {
      status: true,
      bookingIds: true,
      userPackageId: true,
      bookingClaimAt: true,
      bookingClaimBy: true,
    },
  });
  if (!fresh) return { outcome: 'gone' };
  if (isFulfilled(fresh, params.kind)) {
    return {
      outcome: 'already_fulfilled',
      bookingIds: fresh.bookingIds,
      userPackageId: fresh.userPackageId,
    };
  }
  if (fresh.bookingClaimAt) {
    // A live lease held by someone else — the normal "another path got
    // here first" case. Stealing it is what caused the double booking.
    log.info(
      {
        op: 'payment.claim',
        paymentId: params.paymentId,
        extra: {
          holder: params.holder,
          heldBy: fresh.bookingClaimBy,
          heldSince: fresh.bookingClaimAt.toISOString(),
        },
      },
      'Booking lease held by another path — waiting instead of booking',
    );
  }
  return { outcome: 'busy', heldBy: fresh.bookingClaimBy, heldSince: fresh.bookingClaimAt };
}

/**
 * Release the lease we hold. Safe to call unconditionally — the
 * `bookingClaimBy` guard means we never clear someone else's lease
 * (e.g. one we let expire and that has since been re-taken).
 *
 * Best-effort: a failure here only delays the next recovery attempt by
 * at most `BOOKING_LEASE_MS`, so it must never mask the real outcome.
 */
export async function releaseBookingLease(paymentId: string, holder: string): Promise<void> {
  try {
    await prisma.payment.updateMany({
      where: { id: paymentId, bookingClaimBy: holder },
      data: { bookingClaimAt: null, bookingClaimBy: null },
    });
  } catch (e) {
    log.error({ op: 'payment.claim', paymentId }, 'Failed to release booking lease', e);
  }
}

/**
 * Poll a payment until another path finishes fulfilling it.
 *
 * This is what every loser of the claim does instead of booking — the
 * behaviour `/api/payments/verify` already had for the capture race,
 * now available to the webhook and the reconciler too.
 *
 * Returns the fulfilled row, or `null` if the holder never finished
 * within `timeoutMs` (caller decides whether that's an error worth
 * flagging).
 */
export async function waitForFulfilment(params: {
  paymentId: string;
  kind: FulfilmentKind;
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<{ status: string; bookingIds: string[]; userPackageId: string | null } | null> {
  const timeoutMs = params.timeoutMs ?? 12_000;
  const intervalMs = params.intervalMs ?? 500;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const fresh = await prisma.payment.findUnique({
      where: { id: params.paymentId },
      select: { status: true, bookingIds: true, userPackageId: true },
    });
    if (!fresh) return null;
    if (isFulfilled(fresh, params.kind)) return fresh;
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
