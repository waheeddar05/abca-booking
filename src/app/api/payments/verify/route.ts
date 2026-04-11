import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';
import { verifyPaymentSignature } from '@/lib/razorpay';
import { notifyPaymentSuccess } from '@/lib/notifications';
import { debitWallet, isWalletEnabled } from '@/lib/wallet';
import { executeSlotBooking, BookingServiceError } from '@/app/api/slots/book/route';

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

    if (!payment) {
      return NextResponse.json({ error: 'Payment record not found' }, { status: 404 });
    }

    if (payment.userId !== user.id) {
      return NextResponse.json({ error: 'Payment does not belong to this user' }, { status: 403 });
    }

    if (payment.status !== 'CREATED') {
      return NextResponse.json({ error: 'Payment already processed' }, { status: 400 });
    }

    if (payment.razorpayOrderId !== razorpay_order_id) {
      return NextResponse.json({ error: 'Order ID mismatch' }, { status: 400 });
    }

    // Verify signature
    const isValid = verifyPaymentSignature({
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature,
    });

    if (!isValid) {
      console.error(`[PaymentVerify user=${user.id} name=${user.name || 'N/A'}] Invalid signature for payment ${paymentId}, order ${razorpay_order_id}`);
      // Mark payment as failed
      await prisma.payment.update({
        where: { id: paymentId },
        data: {
          status: 'FAILED',
          failureReason: 'Invalid payment signature',
          razorpayPaymentId: razorpay_payment_id,
          razorpaySignature: razorpay_signature,
        },
      });
      return NextResponse.json({ error: 'Payment verification failed' }, { status: 400 });
    }

    console.log(`[PaymentVerify user=${user.id} name=${user.name || 'N/A'}] Payment verified successfully: ${paymentId}, razorpay=${razorpay_payment_id}, type=${payment.paymentType}`);
    // Signature valid — mark as captured
    await prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: 'CAPTURED',
        razorpayPaymentId: razorpay_payment_id,
        razorpaySignature: razorpay_signature,
      },
    });

    // Now complete the actual booking/purchase based on payment type
    let result: Record<string, unknown> = {};

    if (payment.paymentType === 'PACKAGE_PURCHASE') {
      result = await completePackagePurchase(payment, user.id);
    }

    if (payment.paymentType === 'SLOT_BOOKING') {
      const meta = payment.metadata as Record<string, unknown> | null;
      const bookingPayload = meta?.bookingPayload as Record<string, unknown>[] | undefined;

      if (bookingPayload && bookingPayload.length > 0) {
        console.log(`[PaymentVerify user=${user.id} name=${user.name || 'N/A'}] Creating bookings atomically for payment ${payment.id} (${bookingPayload.length} slot(s))`);
        try {
          // Attach paymentId to each slot so the booking logic links them
          const slotsWithPayment = bookingPayload.map(slot => ({
            ...slot,
            paymentId: payment.id,
          }));

          const bookings = await executeSlotBooking(user, slotsWithPayment, {
            onlinePaymentId: payment.id,
          });

          console.log(`[PaymentVerify user=${user.id}] Bookings created successfully: ${bookings.map(b => b.id).join(', ')}`);
          result = { bookings };
        } catch (bookingErr) {
          // Booking failed after payment was captured — the executeSlotBooking function
          // already handles auto-refund to wallet internally. Log and return the error.
          const errMsg = bookingErr instanceof Error ? bookingErr.message : 'Booking creation failed after payment';
          console.error(`[PaymentVerify user=${user.id}] Booking creation failed after payment CAPTURED:`, bookingErr);

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
        // Legacy: no bookingPayload stored — frontend will call /api/slots/book separately.
        // This handles in-flight payments that were created before this code change.
        console.warn(`[PaymentVerify user=${user.id}] No bookingPayload in payment metadata for ${payment.id} — frontend must call /api/slots/book`);
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
    console.error('Payment verify error:', error);
    const message = error instanceof Error ? error.message : 'Payment verification failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Complete a package purchase after successful payment
 */
async function completePackagePurchase(
  payment: { id: string; amount: number; metadata: unknown },
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
      const walletEnabled = await isWalletEnabled();
      if (walletEnabled) {
        await debitWallet(
          userId,
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
