import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';
import { verifyPaymentSignatureForCenter } from '@/lib/razorpay';
import { notifyPaymentSuccess } from '@/lib/notifications';
import { debitWallet, isWalletEnabled } from '@/lib/wallet';
import { executeSlotBooking, BookingServiceError } from '@/app/api/slots/book/route';
import {
  executeResourceBooking,
  ResourceBookingBodySchema,
  ResourceBookingServiceError,
} from '@/app/api/slots/book-resource/route';
import { BookingResourceError } from '@/lib/resource-booking';
import { log } from '@/lib/logger';

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

    // Idempotency: the Razorpay *webhook* can race the client-side verify
    // call. If the webhook arrived first, the Payment is already CAPTURED
    // and the bookings are already created. In that case the client must
    // see success — not "Payment already processed" — so it can route
    // to /bookings. Same story for REFUNDED (the webhook + auto-refund
    // already handled the failure).
    if (payment.status === 'CAPTURED') {
      log.info(baseCtx, 'Payment already CAPTURED (likely by webhook); returning current state');
      if (payment.bookingIds.length > 0) {
        const existing = await prisma.booking.findMany({
          where: { id: { in: payment.bookingIds } },
          select: { id: true, status: true },
        });
        return NextResponse.json({
          success: true,
          paymentId: payment.id,
          razorpayPaymentId: payment.razorpayPaymentId,
          type: payment.paymentType,
          bookings: existing,
          alreadyProcessed: true,
        });
      }
      if (payment.paymentType === 'PACKAGE_PURCHASE' && payment.userPackageId) {
        const userPackage = await prisma.userPackage.findUnique({
          where: { id: payment.userPackageId },
          include: { package: true },
        });
        return NextResponse.json({
          success: true,
          paymentId: payment.id,
          razorpayPaymentId: payment.razorpayPaymentId,
          type: payment.paymentType,
          userPackage,
          alreadyProcessed: true,
        });
      }
      // CAPTURED but neither bookings nor a userPackage exist yet —
      // either the webhook is currently inside its booking transaction
      // (lost the race by milliseconds) OR the webhook failed silently
      // earlier. Give it a brief window to finish, then re-check.
      // Running our own booking concurrently would risk a duplicate.
      await new Promise((r) => setTimeout(r, 1500));
      const recheck = await prisma.payment.findUnique({ where: { id: paymentId } });
      if (recheck && recheck.bookingIds.length > 0) {
        const existing = await prisma.booking.findMany({
          where: { id: { in: recheck.bookingIds } },
          select: { id: true, status: true },
        });
        return NextResponse.json({
          success: true,
          paymentId: recheck.id,
          razorpayPaymentId: recheck.razorpayPaymentId,
          type: recheck.paymentType,
          bookings: existing,
          alreadyProcessed: true,
        });
      }
      if (recheck && recheck.status === 'REFUNDED') {
        return NextResponse.json({
          success: false,
          error: recheck.failureReason || 'Payment was refunded',
          paymentId: recheck.id,
          razorpayPaymentId: recheck.razorpayPaymentId,
          type: recheck.paymentType,
          refunded: true,
          refundAmount: recheck.refundAmount,
        }, { status: 200 });
      }
      // Still nothing after the wait — fall through and let this call
      // attempt the booking. The booking engine's serializable transaction
      // is the final defence against a duplicate.
    }

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

    log.info(baseCtx, `Signature verified (currentStatus=${payment.status})`);
    // Mark as captured (idempotent — webhook may have already done this).
    // We always re-write the razorpay payment id + signature so the row
    // captures both event sources.
    if (payment.status === 'CREATED') {
      await prisma.payment.update({
        where: { id: paymentId },
        data: {
          status: 'CAPTURED',
          razorpayPaymentId: razorpay_payment_id,
          razorpaySignature: razorpay_signature,
        },
      });
    } else if (!payment.razorpaySignature) {
      // Already CAPTURED by webhook (which doesn't store the signature).
      // Backfill so refunds + audits have the full record.
      await prisma.payment.update({
        where: { id: paymentId },
        data: {
          razorpayPaymentId: razorpay_payment_id,
          razorpaySignature: razorpay_signature,
        },
      });
    }

    // Now complete the actual booking/purchase based on payment type
    let result: Record<string, unknown> = {};

    if (payment.paymentType === 'PACKAGE_PURCHASE') {
      result = await completePackagePurchase(payment, user.id);
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

/**
 * Complete a package purchase after successful payment
 */
async function completePackagePurchase(
  payment: { id: string; amount: number; metadata: unknown; centerId: string },
  userId: string,
) {
  const meta = payment.metadata as Record<string, unknown> | null;
  const packageId = meta?.packageId as string | undefined;
  const walletDeduction = (meta?.walletDeduction as number) || 0;

  if (!packageId) {
    throw new Error('Package ID missing from payment metadata');
  }

  const pkg = await prisma.package.findUnique({ where: { id: packageId } });
  if (!pkg) throw new Error('Package not found');

  // Check for existing active package with remaining sessions
  const activePackages = await prisma.userPackage.findMany({
    where: {
      userId,
      packageId: pkg.id,
      status: 'ACTIVE',
      expiryDate: { gte: new Date() },
    },
  });

  const packageWithSessions = activePackages.find(
    (up) => up.usedSessions < up.totalSessions,
  );

  if (packageWithSessions) {
    throw new Error(
      `Already have an active "${pkg.name}" package with remaining sessions`,
    );
  }

  // Total paid = Razorpay amount + wallet deduction
  const totalAmountPaid = payment.amount + walletDeduction;

  const activation = new Date();
  const expiry = new Date(activation);
  expiry.setDate(expiry.getDate() + pkg.validityDays);

  const userPackage = await prisma.userPackage.create({
    data: {
      userId,
      packageId: pkg.id,
      totalSessions: pkg.totalSessions,
      usedSessions: 0,
      activationDate: activation,
      expiryDate: expiry,
      status: 'ACTIVE',
      amountPaid: totalAmountPaid,
    },
    include: { package: true },
  });

  // Link payment to the user package
  await prisma.payment.update({
    where: { id: payment.id },
    data: { userPackageId: userPackage.id },
  });

  // Debit wallet if wallet deduction was specified
  if (walletDeduction > 0) {
    try {
      const walletEnabled = await isWalletEnabled(payment.centerId);
      if (walletEnabled) {
        await debitWallet(
          userId,
          payment.centerId,
          walletDeduction,
          'DEBIT_BOOKING',
          `Package purchase: ${pkg.name}`,
          userPackage.id,
        );
      }
    } catch (walletErr) {
      console.error('Wallet debit for package purchase failed:', walletErr);
      // Don't fail the purchase since Razorpay payment already succeeded
    }
  }

  // Send notification (in-app + WhatsApp if configured)
  try {
    const notifUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { mobileNumber: true, mobileVerified: true },
    });
    await notifyPaymentSuccess(userId, {
      message: `Your "${pkg.name}" package (${pkg.totalSessions} sessions) is now active. Valid until ${expiry.toLocaleDateString('en-IN')}.`,
      mobileNumber: notifUser?.mobileVerified ? notifUser.mobileNumber : null,
    });
  } catch (notifErr) {
    console.error('Failed to send package purchase notification:', notifErr);
  }

  return { userPackage };
}

/**
 * Stamp the Payment row's metadata with a `recovery` block so the
 * `/api/admin/payments/orphans` endpoint can find it. We do NOT change
 * `status` (still CAPTURED) — Razorpay considers the payment good, and
 * the booking is just missing. The orphan tool walks `status=CAPTURED`
 * AND `bookingIds=[]` AND `paymentType=SLOT_BOOKING` to build its list.
 */
async function markCaptureNeedsRecovery(paymentId: string, reason: string): Promise<void> {
  const existing = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { metadata: true },
  });
  const meta =
    existing && typeof existing.metadata === 'object' && existing.metadata !== null
      ? (existing.metadata as Record<string, unknown>)
      : {};
  await prisma.payment.update({
    where: { id: paymentId },
    data: {
      metadata: {
        ...meta,
        recovery: {
          flaggedAt: new Date().toISOString(),
          reason,
          handled: false,
        },
      } as never,
      failureReason: reason,
    },
  });
}
