import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { executeSlotBooking, BookingServiceError } from '@/app/api/slots/book/route';
import { creditWallet } from '@/lib/wallet';

/**
 * POST /api/webhooks/razorpay
 *
 * Server-to-server webhook from Razorpay. Handles `payment.captured` events
 * as a safety net: if the browser failed to call /api/payments/verify (network
 * drop, PWA killed, UPI redirect failure), this webhook still completes the
 * booking server-side.
 *
 * Setup in Razorpay Dashboard → Settings → Webhooks:
 *   URL:    https://<your-domain>/api/webhooks/razorpay
 *   Secret: same as RAZORPAY_WEBHOOK_SECRET env var
 *   Events: payment.captured
 */
export async function POST(req: NextRequest) {
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error('[RazorpayWebhook] RAZORPAY_WEBHOOK_SECRET not configured');
      return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
    }

    // Read raw body for signature verification
    const rawBody = await req.text();
    const signature = req.headers.get('x-razorpay-signature');

    if (!signature) {
      return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
    }

    // Verify webhook signature
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex');

    if (expectedSignature !== signature) {
      console.error('[RazorpayWebhook] Invalid signature');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    const event = JSON.parse(rawBody);
    const eventType = event.event as string;

    // We only care about payment.captured
    if (eventType !== 'payment.captured') {
      return NextResponse.json({ status: 'ignored', event: eventType });
    }

    const razorpayPayment = event.payload?.payment?.entity;
    if (!razorpayPayment) {
      return NextResponse.json({ error: 'Missing payment entity' }, { status: 400 });
    }

    const razorpayOrderId = razorpayPayment.order_id as string;
    const razorpayPaymentId = razorpayPayment.id as string;

    console.log(`[RazorpayWebhook] payment.captured: order=${razorpayOrderId} payment=${razorpayPaymentId}`);

    // Find our payment record by Razorpay order ID
    const payment = await prisma.payment.findFirst({
      where: { razorpayOrderId },
    });

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

    // If still CREATED, the browser's verify call never arrived. Mark as CAPTURED.
    if (payment.status === 'CREATED') {
      console.log(`[RazorpayWebhook] Payment ${payment.id} still CREATED — marking CAPTURED via webhook`);
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'CAPTURED',
          razorpayPaymentId,
        },
      });
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

      try {
        const slotsWithPayment = bookingPayload.map(slot => ({
          ...slot,
          paymentId: payment.id,
        }));

        console.log(`[RazorpayWebhook] Creating ${bookingPayload.length} booking(s) for payment ${payment.id} user=${user.id}`);

        const bookings = await executeSlotBooking(
          {
            id: user.id,
            name: user.name || undefined,
            role: user.role,
            email: user.email || undefined,
            isSuperAdmin,
            isFreeUser: user.isFreeUser,
            isSpecialUser: user.isSpecialUser,
            mobileVerified: user.mobileVerified,
          },
          slotsWithPayment,
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

    // For PACKAGE_PURCHASE, the verify route handles it. If webhook fires and
    // it's still unprocessed, log it for manual admin review.
    if (payment.paymentType === 'PACKAGE_PURCHASE' && !payment.userPackageId) {
      console.warn(`[RazorpayWebhook] Unprocessed package purchase ${payment.id} — needs manual review`);
      return NextResponse.json({ status: 'package_needs_review' });
    }

    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    console.error('[RazorpayWebhook] Error:', error);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
