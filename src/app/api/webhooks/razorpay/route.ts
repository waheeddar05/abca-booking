import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { executeSlotBooking } from '@/app/api/slots/book/route';
import { getCenterRazorpayCredentials, verifyWebhookSignatureWithSecret } from '@/lib/razorpay';

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
