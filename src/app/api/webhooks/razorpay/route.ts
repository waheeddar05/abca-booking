import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { executeSlotBooking } from '@/app/api/slots/book/route';
import {
  executeResourceBooking,
  ResourceBookingBodySchema,
} from '@/app/api/slots/book-resource/route';
import { getCenterRazorpayCredentials, verifyWebhookSignatureWithSecret } from '@/lib/razorpay';
import { completePackagePurchase } from '@/lib/package-purchase';
import { notifyAdminPaymentIssue } from '@/lib/notifications';
import { markCaptureNeedsRecovery } from '@/lib/payment-recovery';

/**
 * POST /api/webhooks/razorpay
 *
 * Multi-center webhook handler.
 *
 * Multiple Razorpay accounts (one per center) all POST here. We identify
 * the originating center from the order_id → Payment row → centerId, then
 * verify the signature with that center's webhook secret. The env
 * `RAZORPAY_WEBHOOK_SECRET` is used as a fallback for centers without a
 * configured webhook secret (single-center installs, or centers still on
 * the platform-wide account).
 *
 * Setup in EACH center's Razorpay Dashboard → Settings → Webhooks:
 *   URL:    https://<your-domain>/api/webhooks/razorpay
 *   Secret: matches Center.razorpayWebhookSecret (or RAZORPAY_WEBHOOK_SECRET env)
 *   Events: payment.captured
 */
export async function POST(req: NextRequest) {
  try {
    // Read raw body once — we need it for both parsing and signature verification.
    const rawBody = await req.text();
    const signature = req.headers.get('x-razorpay-signature');
    if (!signature) {
      return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
    }

    // Parse the body BEFORE verifying. We trust nothing in it yet — we
    // just need order_id to find which center this webhook came from.
    // The signature check below is the actual trust boundary.
    let event: { event?: string; payload?: { payment?: { entity?: Record<string, unknown> } } };
    try {
      event = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const eventType = event.event;
    const razorpayPayment = event.payload?.payment?.entity as Record<string, unknown> | undefined;
    const razorpayOrderId = razorpayPayment?.order_id as string | undefined;
    const razorpayPaymentId = razorpayPayment?.id as string | undefined;

    if (!razorpayOrderId) {
      return NextResponse.json({ error: 'Missing order_id' }, { status: 400 });
    }

    // Identify the center via the local Payment row. If unknown, we'll
    // fall back to env credentials (single-center installs).
    const payment = await prisma.payment.findFirst({
      where: { razorpayOrderId },
    });

    let webhookSecret: string | null = null;
    if (payment) {
      const creds = await getCenterRazorpayCredentials(payment.centerId);
      webhookSecret = creds?.webhookSecret ?? null;
    }
    if (!webhookSecret) webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || null;

    if (!webhookSecret) {
      console.error('[RazorpayWebhook] No webhook secret configured (center or env)');
      return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
    }

    // The actual trust boundary — verify with the resolved secret.
    if (!verifyWebhookSignatureWithSecret({ body: rawBody, signature, webhookSecret })) {
      console.error(
        `[RazorpayWebhook] Invalid signature (center=${payment?.centerId ?? 'env'}, order=${razorpayOrderId})`,
      );
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    if (eventType !== 'payment.captured') {
      return NextResponse.json({ status: 'ignored', event: eventType });
    }

    if (!razorpayPaymentId) {
      return NextResponse.json({ error: 'Missing payment id' }, { status: 400 });
    }

    console.log(
      `[RazorpayWebhook] payment.captured: order=${razorpayOrderId} payment=${razorpayPaymentId} center=${payment?.centerId ?? 'unknown'}`,
    );

    if (!payment) {
      console.warn(`[RazorpayWebhook] No payment record found for order ${razorpayOrderId}`);
      return NextResponse.json({ status: 'no_record' });
    }

    // If already processed (CAPTURED with bookings, or REFUNDED), skip
    if (payment.status === 'CAPTURED' && payment.bookingIds.length > 0) {
      console.log(`[RazorpayWebhook] Payment ${payment.id} already completed with ${payment.bookingIds.length} booking(s) — skipping`);
      return NextResponse.json({ status: 'already_completed' });
    }

    if (payment.status === 'REFUNDED') {
      console.log(`[RazorpayWebhook] Payment ${payment.id} already refunded — skipping`);
      return NextResponse.json({ status: 'already_refunded' });
    }

    // Atomic claim — match the same protocol /api/payments/verify uses.
    // Whichever path (this webhook or the client-driven verify) flips
    // CREATED→CAPTURED first owns the booking creation. The losing
    // path bails out instead of attempting its own booking, which
    // previously caused duplicate-booking + spurious-refund incidents
    // (see verify route's same atomic-claim comment).
    if (payment.status === 'CREATED') {
      const claim = await prisma.payment.updateMany({
        where: { id: payment.id, status: 'CREATED' },
        data: {
          status: 'CAPTURED',
          razorpayPaymentId,
        },
      });
      if (claim.count === 0) {
        console.log(`[RazorpayWebhook] Lost claim for payment ${payment.id} — verify is processing`);
        return NextResponse.json({ status: 'claim_lost_to_verify' });
      }
      console.log(`[RazorpayWebhook] Won claim for payment ${payment.id} — proceeding to create bookings`);
    }

    // If CAPTURED but no bookings — the verify call either didn't happen or booking failed.
    // Try to create bookings now.
    if (payment.paymentType === 'SLOT_BOOKING') {
      if (payment.bookingIds.length > 0) {
        console.log(`[RazorpayWebhook] Payment ${payment.id} already has bookings — skipping`);
        return NextResponse.json({ status: 'already_has_bookings' });
      }

      const meta = payment.metadata as Record<string, unknown> | null;
      const bookingPayload = meta?.bookingPayload as Record<string, unknown>[] | undefined;

      if (!bookingPayload || bookingPayload.length === 0) {
        console.warn(`[RazorpayWebhook] No bookingPayload in metadata for payment ${payment.id} — cannot auto-create bookings`);
        // Captured but no booking details to act on — flag + alert admins.
        await markCaptureNeedsRecovery(
          payment.id,
          'Webhook: captured payment has no bookingPayload — cannot auto-book',
        ).catch((e) => console.error('[RazorpayWebhook] flag for recovery failed:', e));
        await notifyAdminPaymentIssue({
          paymentId: payment.id,
          outcome: 'NEEDS_ATTENTION',
          reason: 'Captured payment has no booking details stored — manual refund/booking needed.',
        }).catch((e) => console.error('[RazorpayWebhook] admin alert failed:', e));
        return NextResponse.json({ status: 'no_booking_payload' });
      }

      // Fetch user for executeSlotBooking
      const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || process.env.INITIAL_ADMIN_EMAIL || '';
      const user = await prisma.user.findUnique({
        where: { id: payment.userId },
        select: {
          id: true, name: true, role: true, email: true,
          isFreeUser: true, isSpecialUser: true, mobileVerified: true,
        },
      });

      if (!user) {
        console.error(`[RazorpayWebhook] User ${payment.userId} not found for payment ${payment.id}`);
        return NextResponse.json({ status: 'user_not_found' });
      }

      const isSuperAdmin = !!(user.email && SUPER_ADMIN_EMAIL && user.email === SUPER_ADMIN_EMAIL);
      const authedUser = {
        id: user.id,
        name: user.name || undefined,
        role: user.role,
        email: user.email || undefined,
        isSuperAdmin,
        isFreeUser: user.isFreeUser,
        isSpecialUser: user.isSpecialUser,
        mobileVerified: user.mobileVerified,
      };

      // Route by center.bookingModel — RESOURCE_BASED centers (Toplay)
      // store the resource-shaped payload in metadata.bookingPayload[0]
      // and MUST NOT be fed through executeSlotBooking (legacy ABCA
      // path), which fails their payload as "Missing required fields"
      // and triggers an unnecessary wallet refund.
      const center = await prisma.center.findUnique({
        where: { id: payment.centerId },
        select: { id: true, name: true, bookingModel: true },
      });
      if (!center) {
        console.error(`[RazorpayWebhook] Center ${payment.centerId} not found for payment ${payment.id}`);
        return NextResponse.json({ status: 'center_not_found' });
      }

      if (center.bookingModel === 'RESOURCE_BASED') {
        const raw = bookingPayload[0];
        const parsed = ResourceBookingBodySchema.safeParse(raw);
        if (!parsed.success) {
          console.error(`[RazorpayWebhook] Resource booking payload invalid for ${payment.id}:`, parsed.error.issues);
          return NextResponse.json({ status: 'invalid_payload', issues: parsed.error.issues });
        }
        try {
          console.log(`[RazorpayWebhook] Creating resource booking(s) for payment ${payment.id} user=${user.id}`);
          const bookings = await executeResourceBooking(authedUser, parsed.data, center, {
            onlinePaymentId: payment.id,
          });
          await prisma.payment.update({
            where: { id: payment.id },
            data: { bookingIds: bookings.map(b => b.id) },
          }).catch((e) => console.error(`[RazorpayWebhook] Failed to link bookingIds on ${payment.id}:`, e));
          console.log(`[RazorpayWebhook] Resource bookings created via webhook: ${bookings.map(b => b.id).join(', ')}`);
          return NextResponse.json({ status: 'bookings_created', bookingIds: bookings.map(b => b.id) });
        } catch (bookingErr) {
          const errMsg = bookingErr instanceof Error ? bookingErr.message : 'Booking failed';
          console.error(`[RazorpayWebhook] Resource booking creation failed for ${payment.id}:`, bookingErr);
          return NextResponse.json({ status: 'booking_failed', error: errMsg });
        }
      }

      try {
        const slotsWithPayment = bookingPayload.map(slot => ({
          ...slot,
          paymentId: payment.id,
        }));

        console.log(`[RazorpayWebhook] Creating ${bookingPayload.length} booking(s) for payment ${payment.id} user=${user.id}`);

        const bookings = await executeSlotBooking(
          authedUser,
          slotsWithPayment,
          payment.centerId,
          { onlinePaymentId: payment.id },
        );

        console.log(`[RazorpayWebhook] Bookings created via webhook: ${bookings.map(b => b.id).join(', ')}`);
        return NextResponse.json({ status: 'bookings_created', bookingIds: bookings.map(b => b.id) });
      } catch (bookingErr) {
        // executeSlotBooking already handles auto-refund to wallet internally
        const errMsg = bookingErr instanceof Error ? bookingErr.message : 'Booking failed';
        console.error(`[RazorpayWebhook] Booking creation failed for payment ${payment.id}:`, bookingErr);
        return NextResponse.json({ status: 'booking_failed', error: errMsg });
      }
    }

    // PACKAGE_PURCHASE completion. Previously this branch just logged
    // "needs_review" and bailed — but the webhook had already won the
    // atomic-claim race upstream, so the user-driven verify call kept
    // polling for 15s, never saw a `userPackageId` appear, and surfaced
    // "Payment captured but booking is still being processed" to the
    // user. The webhook owns the claim, so it owns the completion.
    if (payment.paymentType === 'PACKAGE_PURCHASE') {
      if (payment.userPackageId) {
        console.log(
          `[RazorpayWebhook] Package ${payment.id} already completed (userPackageId=${payment.userPackageId})`,
        );
        return NextResponse.json({ status: 'already_completed' });
      }
      try {
        const result = await completePackagePurchase(
          {
            id: payment.id,
            amount: payment.amount,
            metadata: payment.metadata,
            centerId: payment.centerId,
          },
          payment.userId,
        );
        console.log(
          `[RazorpayWebhook] Package purchase completed via webhook: payment=${payment.id} userPackage=${result.userPackage.id}`,
        );
        return NextResponse.json({
          status: 'package_completed',
          userPackageId: result.userPackage.id,
        });
      } catch (pkgErr) {
        const errMsg = pkgErr instanceof Error ? pkgErr.message : 'Package completion failed';
        console.error(
          `[RazorpayWebhook] Package purchase completion failed for ${payment.id}:`,
          pkgErr,
        );
        return NextResponse.json({ status: 'package_failed', error: errMsg });
      }
    }

    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    console.error('[RazorpayWebhook] Error:', error);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
