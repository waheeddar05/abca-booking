/**
 * Reserve-then-confirm (saga) lifecycle for the booking/payment flow.
 *
 * Goal: make a paid booking all-or-nothing WITHOUT depending on a cron.
 * The slot is reserved (status=HOLD) the instant the customer starts
 * paying — BEFORE Razorpay takes the money. On a confirmed capture the
 * hold is flipped to BOOKED; if the payment never completes the hold is
 * swept to CANCELLED once it expires (lazily, on the next availability
 * read or reserve — no background job).
 *
 * Everything here is gated by the per-center `RESERVE_BEFORE_PAYMENT`
 * policy (default OFF). With the flag off, no HOLD rows are ever created,
 * `confirmHeldBookings` always returns {confirmed:false} so callers fall
 * back to today's create-from-scratch path, and the sweep is a no-op —
 * i.e. the whole feature is inert and behaviour is unchanged.
 */
import { prisma } from './prisma';
import { isPolicyEnabled } from './policy';
import { debitWallet } from './wallet';
import { notifyCustomerNewBooking, notifyAssignedStaffNewBooking } from './notifications';
import { log } from './logger';

/** How long a reservation is held before the customer must have paid. */
export const HOLD_TTL_MS = 20 * 60 * 1000; // 20 minutes

/** Per-center toggle for the reserve-then-confirm flow. Default OFF. */
export async function isReserveBeforePayment(centerId: string | null): Promise<boolean> {
  try {
    return await isPolicyEnabled('RESERVE_BEFORE_PAYMENT', centerId, false);
  } catch {
    return false;
  }
}

export function newHoldExpiry(now: number = Date.now()): Date {
  return new Date(now + HOLD_TTL_MS);
}

// ─── Lazy expiry sweep ──────────────────────────────────────────────

/**
 * Cancel HOLD rows whose `holdExpiresAt` has passed and whose payment was
 * NOT captured (a captured-but-unconfirmed hold is left for confirm to
 * finalize). Cancelling frees the slot/resources because every occupancy
 * query excludes CANCELLED rows. Called opportunistically from the
 * availability reads and the reserve path — no cron.
 *
 * Returns the number of holds cancelled.
 */
export async function expireStaleHolds(centerId?: string, now: Date = new Date()): Promise<number> {
  const candidates = await prisma.booking.findMany({
    where: {
      status: 'HOLD',
      holdExpiresAt: { lte: now },
      ...(centerId ? { centerId } : {}),
    },
    select: { id: true, paymentId: true },
    take: 500,
  });
  if (candidates.length === 0) return 0;

  // Never cancel a hold whose payment already captured — confirm owns it.
  const paymentIds = [...new Set(candidates.map((c) => c.paymentId).filter(Boolean))] as string[];
  const captured =
    paymentIds.length > 0
      ? await prisma.payment.findMany({
          where: { id: { in: paymentIds }, status: 'CAPTURED' },
          select: { id: true },
        })
      : [];
  const capturedSet = new Set(captured.map((p) => p.id));

  const toCancel = candidates
    .filter((c) => !c.paymentId || !capturedSet.has(c.paymentId))
    .map((c) => c.id);
  if (toCancel.length === 0) return 0;

  const res = await prisma.booking.updateMany({
    where: { id: { in: toCancel }, status: 'HOLD' },
    data: {
      status: 'CANCELLED',
      cancelledBy: 'system',
      cancellationReason: 'Reservation expired — payment not completed',
    },
  });
  if (res.count > 0) {
    log.info(
      { op: 'booking.hold.expire', centerId: centerId ?? null, extra: { cancelled: res.count } },
      `Expired ${res.count} stale hold(s)`,
    );
  }
  return res.count;
}

// ─── Confirm ────────────────────────────────────────────────────────

export type ConfirmResult =
  | { confirmed: true; bookings: Array<{ id: string; status: string }>; alreadyConfirmed: boolean }
  | { confirmed: false };

/**
 * Finalize the held bookings for a captured payment by flipping
 * HOLD→BOOKED, then debiting any wallet portion and notifying.
 *
 * Idempotent and backward-compatible:
 *   • bookings already BOOKED for this payment → {confirmed:true, alreadyConfirmed:true}
 *   • HOLD rows present → flip + finalize → {confirmed:true}
 *   • no rows for this payment (flag was off, or the hold was swept) →
 *     {confirmed:false}; the caller should run its create-from-scratch path.
 */
export async function confirmHeldBookings(paymentId: string): Promise<ConfirmResult> {
  const ctx = { op: 'booking.hold.confirm', paymentId } as const;

  const rows = await prisma.booking.findMany({
    where: { paymentId, status: { in: ['HOLD', 'BOOKED'] } },
    select: { id: true, status: true },
  });
  if (rows.length === 0) return { confirmed: false };

  const holdIds = rows.filter((r) => r.status === 'HOLD').map((r) => r.id);

  // Already confirmed (idempotent re-entry from a racing verify/webhook).
  if (holdIds.length === 0) {
    log.info(ctx, 'Holds already confirmed — returning existing bookings');
    return { confirmed: true, bookings: rows, alreadyConfirmed: true };
  }

  // Flip exactly the HOLD rows → BOOKED/PAID atomically. updateMany with
  // `status:'HOLD'` in the where makes this race-safe: a concurrent caller
  // gets count 0 and we treat it as already-confirmed below.
  const flip = await prisma.booking.updateMany({
    where: { id: { in: holdIds }, status: 'HOLD' },
    data: { status: 'BOOKED', paymentStatus: 'PAID', paymentMethod: 'ONLINE', holdExpiresAt: null },
  });
  log.info({ ...ctx, extra: { flipped: flip.count, total: rows.length } }, 'Confirmed held bookings');

  const bookings = await prisma.booking.findMany({
    where: { paymentId, status: { in: ['BOOKED', 'DONE'] } },
    select: { id: true, status: true },
  });
  const bookingIds = bookings.map((b) => b.id);

  // Link payment → bookings (refund/recovery flows rely on this), and read
  // the payment to settle any wallet portion.
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (payment) {
    await prisma.payment
      .update({ where: { id: paymentId }, data: { bookingIds } })
      .catch((e) => log.error(ctx, 'Failed to link payment.bookingIds', e));

    const meta = (payment.metadata && typeof payment.metadata === 'object'
      ? payment.metadata
      : {}) as Record<string, unknown>;
    const walletDeduction = Number(meta.walletDeduction) || 0;
    if (walletDeduction > 0 && bookingIds.length > 0) {
      try {
        await debitWallet(
          payment.userId,
          payment.centerId,
          walletDeduction,
          'DEBIT_BOOKING',
          `Booking payment (wallet portion, ${bookingIds.length} slot${bookingIds.length === 1 ? '' : 's'})`,
          bookingIds[0],
        );
      } catch (walletErr) {
        // The Razorpay portion is already captured and the booking is
        // confirmed; a wallet-debit hiccup must not un-confirm it. Log so
        // it can be reconciled, but keep the booking.
        log.error(ctx, 'Wallet debit on confirm failed (booking kept)', walletErr);
      }
    }
  }

  // Notifications were deliberately deferred from reserve time.
  if (bookingIds.length > 0) {
    try {
      await notifyCustomerNewBooking(bookingIds);
      await notifyAssignedStaffNewBooking(bookingIds);
    } catch (notifyErr) {
      log.error(ctx, 'Confirm notifications failed (non-fatal)', notifyErr);
    }
  }

  return { confirmed: true, bookings, alreadyConfirmed: false };
}
