import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';
import { verifyPaymentSignatureForCenter } from '@/lib/razorpay';
import { executeSlotBooking, BookingServiceError } from '@/app/api/slots/book/route';
import {
  executeResourceBooking,
  ResourceBookingBodySchema,
  ResourceBookingServiceError,
} from '@/app/api/slots/book-resource/route';
import { BookingResourceError } from '@/lib/resource-booking';
import { completePackagePurchase } from '@/lib/package-purchase';
import { log } from '@/lib/logger';
import { markCaptureNeedsRecovery } from '@/lib/payment-recovery';

// POST /api/payments/verify - Verify payment and complete booking/purchase
export async function POST(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      paymentId,
    } = body as {
      razorpay_order_id: string;
      razorpay_payment_id: string;
      razorpay_signature: string;
      paymentId: string; // Our internal payment ID
    };

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !paymentId) {
      return NextResponse.json({ error: 'Missing payment verification fields' }, { status: 400 });
    }

    // Find our payment record
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
    });

    // Base log context for every line in this handler. Always includes
    // the action user's id + email so a support engineer can grep one
    // line in Vercel and pull the entire verify lifecycle.
    const baseCtx = {
      op: 'payment.verify',
      user: { id: user.id, email: user.email, name: user.name },
      centerId: payment?.centerId ?? null,
      paymentId,
      razorpayOrderId: razorpay_order_id,
      razorpayPaymentId: razorpay_payment_id,
      amount: payment?.amount ?? null,
      extra: { paymentType: payment?.paymentType ?? null },
    } as const;

    if (!payment) {
      log.warn(baseCtx, 'Payment record not found');
      return NextResponse.json({ error: 'Payment record not found' }, { status: 404 });
    }

    if (payment.userId !== user.id) {
      log.warn(baseCtx, `Ownership mismatch: payment.userId=${payment.userId}`);
      return NextResponse.json({ error: 'Payment does not belong to this user' }, { status: 403 });
    }

    if (payment.razorpayOrderId !== razorpay_order_id) {
      log.warn(baseCtx, `Order ID mismatch: stored=${payment.razorpayOrderId}`);
      return NextResponse.json({ error: 'Order ID mismatch' }, { status: 400 });
    }

    // Reject unrecoverable states up-front so the rest of the handler
    // can assume CREATED-or-CAPTURED only.
    if (payment.status === 'REFUNDED') {
      log.info(baseCtx, `Payment already REFUNDED (amount=₹${payment.refundAmount ?? 0})`);
      return NextResponse.json({
        success: false,
        error: payment.failureReason || 'Payment was refunded',
        paymentId: payment.id,
        razorpayPaymentId: payment.razorpayPaymentId,
        type: payment.paymentType,
        refunded: true,
        refundAmount: payment.refundAmount,
      }, { status: 200 });
    }

    if (payment.status !== 'CREATED' && payment.status !== 'CAPTURED') {
      log.warn(baseCtx, `Cannot verify — payment in non-verifiable state (status=${payment.status})`);
      return NextResponse.json({
        error: `Payment cannot be verified (status=${payment.status})`,
      }, { status: 400 });
    }

    // Verify signature against the center's Razorpay secret. Different
    // centers can have different merchant accounts with different keys.
    const isValid = await verifyPaymentSignatureForCenter({
      centerId: payment.centerId,
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature,
    });

    if (!isValid) {
      log.error(baseCtx, 'Invalid Razorpay signature on verify');
      // Only flip to FAILED when the Payment is still in CREATED — once
      // it's been promoted to CAPTURED (by us or the webhook) it would
      // be wrong to revert that on a stale verify call.
      if (payment.status === 'CREATED') {
        await prisma.payment.update({
          where: { id: paymentId },
          data: {
            status: 'FAILED',
            failureReason: 'Invalid payment signature',
            razorpayPaymentId: razorpay_payment_id,
            razorpaySignature: razorpay_signature,
          },
        });
      }
      return NextResponse.json({ error: 'Payment verification failed' }, { status: 400 });
    }

    // ─── Atomic claim ───────────────────────────────────────────────
    // The Razorpay webhook + this client-driven verify can both arrive
    // ~simultaneously. Whichever flips CREATED→CAPTURED *first* owns
    // the responsibility for creating bookings; the other one MUST NOT
    // run the booking engine a second time. The old code racy-flipped
    // with `prisma.payment.update` (no `where` on status), which let
    // both paths "win" and create duplicate work — symptoms included:
    //   • duplicate bookings (one set hidden via FK conflict, one
    //     visible) plus an erroneous auto-refund-to-wallet for the
    //     "second" path that hit "no nets available" because its
    //     sibling had already claimed the resources;
    //   • user ends up with both bookings AND a wallet refund.
    //
    // updateMany with `where: { status: 'CREATED' }` is atomic at the
    // DB row level: exactly one caller's update returns count=1.
    const claim = await prisma.payment.updateMany({
      where: { id: paymentId, status: 'CREATED' },
      data: {
        status: 'CAPTURED',
        razorpayPaymentId: razorpay_payment_id,
        razorpaySignature: razorpay_signature,
      },
    });
    const wonClaim = claim.count === 1;

    log.info(
      { ...baseCtx, extra: { ...baseCtx.extra, wonClaim, priorStatus: payment.status } },
      wonClaim ? 'Won capture claim — proceeding to create bookings' : 'Lost capture claim — webhook is processing; polling for result',
    );

    if (!wonClaim) {
      // Someone else (the webhook, almost certainly) is between
      // "marked CAPTURED" and "linked bookingIds". Poll the row for a
      // generous window — the inner serializable tx + retries can
      // legitimately take several seconds on a contended center.
      // We deliberately do NOT call executeResourceBooking ourselves
      // here: a concurrent attempt would either duplicate the booking
      // or fail with "no nets available" and trigger a spurious refund.
      const MAX_POLL_MS = 15_000;
      const POLL_INTERVAL_MS = 500;
      const deadline = Date.now() + MAX_POLL_MS;
      let final = await prisma.payment.findUnique({ where: { id: paymentId } });
      while (
        final
        && final.status === 'CAPTURED'
        && final.bookingIds.length === 0
        && (payment.paymentType !== 'PACKAGE_PURCHASE' || !final.userPackageId)
        && Date.now() < deadline
      ) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        final = await prisma.payment.findUnique({ where: { id: paymentId } });
      }
      if (!final) {
        log.error(baseCtx, 'Payment disappeared mid-poll');
        return NextResponse.json({ error: 'Payment record vanished' }, { status: 500 });
      }
      if (final.status === 'REFUNDED') {
        log.info(baseCtx, 'Webhook finished by refunding (booking failure recovered)');
        return NextResponse.json({
          success: false,
          error: final.failureReason || 'Payment was refunded',
          paymentId: final.id,
          razorpayPaymentId: final.razorpayPaymentId,
          type: final.paymentType,
          refunded: true,
          refundAmount: final.refundAmount,
        }, { status: 200 });
      }
      if (final.bookingIds.length > 0) {
        const existing = await prisma.booking.findMany({
          where: { id: { in: final.bookingIds } },
          select: { id: true, status: true },
        });
        log.info(
          { ...baseCtx, bookingIds: final.bookingIds },
          `Bookings created by other path — returning ${existing.length} booking(s) from poll`,
        );
        return NextResponse.json({
          success: true,
          paymentId: final.id,
          razorpayPaymentId: final.razorpayPaymentId,
          type: final.paymentType,
          bookings: existing,
          alreadyProcessed: true,
        });
      }
      if (payment.paymentType === 'PACKAGE_PURCHASE' && final.userPackageId) {
        const userPackage = await prisma.userPackage.findUnique({
          where: { id: final.userPackageId },
          include: { package: true },
        });
        return NextResponse.json({
          success: true,
          paymentId: final.id,
          razorpayPaymentId: final.razorpayPaymentId,
          type: final.paymentType,
          userPackage,
          alreadyProcessed: true,
        });
      }
      // The other path took the claim but never linked anything within
      // 15s. Either it's still running on a slow DB or it crashed
      // silently. Don't pretend success and don't try to create the
      // bookings ourselves — flag the Payment for the orphan-recovery
      // admin tool and surface a clear "processing" error to the user.
      log.error(
        baseCtx,
        'Capture claim lost but no bookings appeared after 15s poll; flagging for recovery',
      );
      await markCaptureNeedsRecovery(
        payment.id,
        'Verify lost claim but other path did not link bookings within 15s',
      ).catch((e) => log.error(baseCtx, 'Failed to flag for recovery', e));
      return NextResponse.json({
        success: false,
        error: 'Payment captured but booking is still being processed. Please refresh in a moment — your booking should appear shortly. If not, our team has been notified.',
        paymentId: payment.id,
        razorpayPaymentId: razorpay_payment_id,
        type: payment.paymentType,
      }, { status: 202 });
    }

    log.info(baseCtx, 'Signature verified, claim won — creating bookings');

    // Now complete the actual booking/purchase based on payment type
    let result: Record<string, unknown> = {};

    if (payment.paymentType === 'PACKAGE_PURCHASE') {
      result = { ...(await completePackagePurchase(payment, user.id)) };
    }

    if (payment.paymentType === 'SLOT_BOOKING') {
      const meta = payment.metadata as Record<string, unknown> | null;
      const bookingPayload = meta?.bookingPayload as Record<string, unknown>[] | undefined;

      if (bookingPayload && bookingPayload.length > 0) {
        // Route by the originating center's booking model. ABCA-style
        // centers (MACHINE_PITCH) keep the legacy multi-slot array; new
        // resource-based centers (Toplay) pass a single body (wrapped
        // as a 1-element array by the client) that we parse against
        // the ResourceBookingBody schema.
        const center = await prisma.center.findUnique({
          where: { id: payment.centerId },
          select: { id: true, name: true, bookingModel: true },
        });
        if (!center) {
          log.error(baseCtx, 'Center missing while verifying payment');
          throw new Error(`Center ${payment.centerId} not found while verifying payment ${payment.id}`);
        }

        log.info({
          ...baseCtx,
          centerId: center.id,
          centerSlug: center.name,
          extra: { ...baseCtx.extra, slots: bookingPayload.length, bookingModel: center.bookingModel },
        }, 'Creating bookings atomically');

        if (center.bookingModel === 'RESOURCE_BASED') {
          try {
            const raw = bookingPayload[0];
            const parsed = ResourceBookingBodySchema.safeParse(raw);
            if (!parsed.success) {
              log.error(baseCtx, `Resource booking payload invalid: ${JSON.stringify(parsed.error.issues)}`);
              throw new Error(`Resource booking payload invalid: ${JSON.stringify(parsed.error.issues)}`);
            }
            const bookings = await executeResourceBooking(user, parsed.data, center, {
              onlinePaymentId: payment.id,
            });
            // Link payment → bookings for the dashboard / refund flow.
            await prisma.payment.update({
              where: { id: payment.id },
              data: { bookingIds: bookings.map(b => b.id) },
            }).catch((e) => log.error(baseCtx, 'Failed to link bookingIds on payment row', e));

            log.info({ ...baseCtx, bookingIds: bookings.map(b => b.id) }, 'Resource bookings created successfully');
            result = { bookings };
          } catch (bookingErr) {
            const errMsg = bookingErr instanceof Error ? bookingErr.message : 'Resource booking creation failed after payment';
            log.error(baseCtx, 'Resource booking failed after CAPTURED', bookingErr);
            await markCaptureNeedsRecovery(payment.id, errMsg).catch((e) =>
              log.error(baseCtx, 'Failed to mark recovery flag', e),
            );
            const status = bookingErr instanceof ResourceBookingServiceError
              ? bookingErr.status
              : bookingErr instanceof BookingResourceError
                ? bookingErr.status
                : 500;
            const extra = bookingErr instanceof ResourceBookingServiceError && bookingErr.extra
              ? bookingErr.extra
              : {};
            return NextResponse.json({
              success: false,
              error: errMsg,
              paymentId: payment.id,
              razorpayPaymentId: razorpay_payment_id,
              type: payment.paymentType,
              ...extra,
            }, { status });
          }
          // Skip the legacy branch.
          return NextResponse.json({
            success: true,
            paymentId: payment.id,
            razorpayPaymentId: razorpay_payment_id,
            type: payment.paymentType,
            ...result,
          });
        }

        try {
          // Attach paymentId to each slot so the booking logic links them
          const slotsWithPayment = bookingPayload.map(slot => ({
            ...slot,
            paymentId: payment.id,
          }));

          const bookings = await executeSlotBooking(user, slotsWithPayment, payment.centerId, {
            onlinePaymentId: payment.id,
          });

          log.info({ ...baseCtx, bookingIds: bookings.map(b => b.id) }, 'Bookings created successfully');
          result = { bookings };
        } catch (bookingErr) {
          // Booking failed after payment was captured. executeSlotBooking
          // *attempts* an auto-refund to wallet, but in production we
          // have observed cases where neither booking nor refund landed
          // (e.g. Prisma schema drift, DB connection blip). Mark the
          // payment row so the orphan-recovery admin endpoint can find
          // it later. Returning 5xx so the client also alerts the user.
          const errMsg = bookingErr instanceof Error ? bookingErr.message : 'Booking creation failed after payment';
          log.error(baseCtx, 'Booking creation failed after payment CAPTURED', bookingErr);

          await markCaptureNeedsRecovery(payment.id, errMsg).catch((e) =>
            log.error(baseCtx, 'Failed to mark recovery flag', e),
          );

          const extra = bookingErr instanceof BookingServiceError ? bookingErr.extra : {};
          return NextResponse.json({
            success: false,
            error: errMsg,
            paymentId: payment.id,
            razorpayPaymentId: razorpay_payment_id,
            type: payment.paymentType,
            ...extra,
          }, { status: bookingErr instanceof BookingServiceError ? bookingErr.status : 500 });
        }
      } else {
        // No bookingPayload in metadata for a SLOT_BOOKING is a bug, not
        // a benign legacy fallthrough. Used to silently return success;
        // that path created money-without-service incidents in prod.
        // Now: log + flag for recovery + return a 5xx so the frontend
        // alerts the user instead of confirming a non-existent booking.
        log.error(baseCtx, 'No bookingPayload in payment.metadata — refusing silent-success');
        await markCaptureNeedsRecovery(
          payment.id,
          'Verify called but bookingPayload missing in payment.metadata',
        ).catch((e) => log.error(baseCtx, 'Failed to flag for recovery', e));
        return NextResponse.json({
          success: false,
          error:
            'Payment captured but booking details were missing. Our team has been notified and will reconcile shortly.',
          paymentId: payment.id,
          razorpayPaymentId: razorpay_payment_id,
          type: payment.paymentType,
        }, { status: 500 });
      }
    }

    return NextResponse.json({
      success: true,
      paymentId: payment.id,
      razorpayPaymentId: razorpay_payment_id,
      type: payment.paymentType,
      ...result,
    });
  } catch (error) {
    log.error({ op: 'payment.verify' }, 'Unhandled error', error);
    const message = error instanceof Error ? error.message : 'Payment verification failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
