import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';
import { initiateRefund } from '@/lib/razorpay';
import { creditWallet } from '@/lib/wallet';
import { notify } from '@/lib/notifications';
import { formatIST } from '@/lib/time';

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user || (user.role !== 'ADMIN' && !user.isSuperAdmin)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const body = await req.json();
    const { bookingId, refundAmount, refundMethod, reason } = body;

    // Validate input
    if (!bookingId || typeof bookingId !== 'string') {
      return NextResponse.json({ error: 'bookingId is required' }, { status: 400 });
    }
    if (!refundAmount || typeof refundAmount !== 'number' || refundAmount <= 0) {
      return NextResponse.json({ error: 'refundAmount must be a positive number' }, { status: 400 });
    }
    if (!refundMethod || !['razorpay', 'wallet'].includes(refundMethod)) {
      return NextResponse.json({ error: 'refundMethod must be "razorpay" or "wallet"' }, { status: 400 });
    }
    if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
      return NextResponse.json({ error: 'reason is required' }, { status: 400 });
    }

    // Fetch booking with payment details
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        user: { select: { id: true, name: true, mobileNumber: true } },
        packageBooking: true,
        refunds: true,
      },
    });

    if (!booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }

    if (!booking.userId) {
      return NextResponse.json({ error: 'Booking has no associated user' }, { status: 400 });
    }

    // Package bookings don't support individual refunds
    if (booking.packageBooking) {
      return NextResponse.json({ error: 'Cannot refund package bookings individually. Refund the package instead.' }, { status: 400 });
    }

    // Find the Payment record for this booking (may not exist for cash/wallet bookings)
    const payment = await prisma.payment.findFirst({
      where: {
        bookingIds: { has: bookingId },
        status: { in: ['CAPTURED', 'PARTIALLY_REFUNDED'] },
      },
      include: { refunds: true },
    });

    // Calculate already refunded amount from booking's refund records
    const alreadyRefunded = (booking.refunds || []).reduce((sum: number, r: any) => {
      if (r.status !== 'FAILED') return sum + r.amount;
      return sum;
    }, 0);

    // For wallet refunds: max is booking price minus already refunded (works for ANY payment method)
    // For razorpay refunds: max is the payment amount minus already refunded via razorpay
    const bookingPrice = booking.price || 0;
    const maxRefundableWallet = Math.max(0, bookingPrice - alreadyRefunded);
    const maxRefundableRazorpay = payment
      ? Math.max(0, payment.amount - payment.refunds.reduce((sum, r) => r.status !== 'FAILED' && r.method === 'RAZORPAY' ? sum + r.amount : sum, 0))
      : 0;

    const maxRefundable = refundMethod === 'razorpay' ? Math.min(maxRefundableWallet, maxRefundableRazorpay) : maxRefundableWallet;

    if (maxRefundable <= 0) {
      return NextResponse.json({ error: 'This booking has already been fully refunded' }, { status: 400 });
    }

    if (refundAmount > maxRefundable) {
      return NextResponse.json({
        error: `Refund amount exceeds maximum refundable amount of ₹${maxRefundable}`,
        maxRefundable,
      }, { status: 400 });
    }

    // Razorpay refunds require an online payment with a valid razorpayPaymentId
    if (refundMethod === 'razorpay') {
      if (!payment) {
        return NextResponse.json({ error: 'No online payment found for this booking. Use wallet refund instead.' }, { status: 400 });
      }
      if (!payment.razorpayPaymentId) {
        return NextResponse.json({ error: 'No Razorpay payment ID found. Use wallet refund instead.' }, { status: 400 });
      }

      // Call Razorpay refund API first — if it fails, don't create DB records
      let razorpayRefund: any;
      try {
        // Use the originating center's Razorpay account.
        razorpayRefund = await initiateRefund({
          centerId: booking.centerId,
          paymentId: payment.razorpayPaymentId,
          amount: refundAmount,
          notes: {
            bookingId,
            reason: reason.trim(),
            initiatedBy: user.id,
            type: 'admin_override',
          },
        });
      } catch (err: any) {
        console.error('Razorpay refund failed:', err);
        return NextResponse.json({
          error: `Razorpay refund failed: ${err?.message || 'Unknown error'}`,
        }, { status: 502 });
      }

      // Razorpay call succeeded — create DB records in a transaction
      const refund = await prisma.$transaction(async (tx) => {
        const newRefund = await tx.refund.create({
          data: {
            bookingId,
            paymentId: payment.id,
            amount: refundAmount,
            method: 'RAZORPAY',
            status: 'INITIATED',
            reason: reason.trim(),
            razorpayRefundId: razorpayRefund.id,
            initiatedById: user.id,
          },
        });

        // Update payment status
        const totalPaymentRefunded = payment.refunds.reduce((sum, r) => r.status !== 'FAILED' ? sum + r.amount : sum, 0) + refundAmount;
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: totalPaymentRefunded >= payment.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
            refundId: razorpayRefund.id,
            refundAmount: totalPaymentRefunded,
            refundedAt: new Date(),
            refundMethod: 'RAZORPAY',
          },
        });

        return newRefund;
      });

      // Send notification (non-blocking)
      const dateStr = formatIST(booking.date, 'dd MMM yyyy');
      notify({
        userId: booking.userId,
        title: 'Refund Initiated',
        message: `A refund of ₹${refundAmount} has been initiated for your booking on ${dateStr}. It will reflect in 5-7 business days.`,
        type: 'SUCCESS',
      }).catch(() => {});

      return NextResponse.json({ refund });
    }

    // Wallet refund — works for ANY booking (online, cash, wallet, free).
    // Wallets are center-scoped, so the refund credits the booking's
    // own-center wallet.
    const walletResult = await creditWallet(
      booking.userId,
      booking.centerId,
      refundAmount,
      'CREDIT_REFUND',
      `Admin refund: ${reason.trim()}`,
      bookingId,
    );

    const refund = await prisma.$transaction(async (tx) => {
      const refundData: any = {
        bookingId,
        amount: refundAmount,
        method: 'WALLET',
        status: 'PROCESSED',
        reason: reason.trim(),
        walletTransactionId: walletResult.transactionId,
        initiatedById: user.id,
      };

      // Link to Payment record if one exists
      if (payment) {
        refundData.paymentId = payment.id;
      }

      const newRefund = await tx.refund.create({ data: refundData });

      // Update payment status if there's a linked payment
      if (payment) {
        const totalPaymentRefunded = payment.refunds.reduce((sum, r) => r.status !== 'FAILED' ? sum + r.amount : sum, 0) + refundAmount;
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: totalPaymentRefunded >= payment.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
            refundAmount: totalPaymentRefunded,
            refundedAt: new Date(),
            refundMethod: 'WALLET',
          },
        });
      }

      return newRefund;
    });

    // Send notification (non-blocking)
    const dateStr = formatIST(booking.date, 'dd MMM yyyy');
    notify({
      userId: booking.userId,
      title: 'Refund Processed',
      message: `A refund of ₹${refundAmount} has been credited to your wallet for your booking on ${dateStr}.`,
      type: 'SUCCESS',
    }).catch(() => {});

    return NextResponse.json({ refund });
  } catch (error: any) {
    console.error('Admin refund error:', error);
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}
