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

    // Must be an online payment booking
    if (booking.paymentMethod !== 'ONLINE') {
      return NextResponse.json({ error: 'Only online-payment bookings can be refunded' }, { status: 400 });
    }

    // Find the Payment record for this booking
    const payment = await prisma.payment.findFirst({
      where: {
        bookingIds: { has: bookingId },
        status: { in: ['CAPTURED', 'PARTIALLY_REFUNDED'] },
      },
      include: { refunds: true },
    });

    if (!payment) {
      return NextResponse.json({ error: 'No completed payment found for this booking' }, { status: 400 });
    }

    // Calculate already refunded amount
    const alreadyRefunded = payment.refunds.reduce((sum, r) => {
      if (r.status !== 'FAILED') return sum + r.amount;
      return sum;
    }, 0);

    const maxRefundable = payment.amount - alreadyRefunded;

    if (maxRefundable <= 0) {
      return NextResponse.json({ error: 'This booking has already been fully refunded' }, { status: 400 });
    }

    if (refundAmount > maxRefundable) {
      return NextResponse.json({
        error: `Refund amount exceeds maximum refundable amount of ₹${maxRefundable}`,
        maxRefundable,
      }, { status: 400 });
    }

    // For razorpay refunds, cap at the gateway-paid portion
    // If booking was partially paid via wallet, the Razorpay portion is payment.amount
    // (wallet debits are separate transactions, not part of this Payment record)
    if (refundMethod === 'razorpay' && !payment.razorpayPaymentId) {
      return NextResponse.json({ error: 'No Razorpay payment ID found for this payment' }, { status: 400 });
    }

    if (refundMethod === 'razorpay') {
      // Call Razorpay refund API first — if it fails, don't create DB records
      let razorpayRefund: any;
      try {
        razorpayRefund = await initiateRefund({
          paymentId: payment.razorpayPaymentId!,
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
        const totalRefunded = alreadyRefunded + refundAmount;
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: totalRefunded >= payment.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
            refundId: razorpayRefund.id,
            refundAmount: totalRefunded,
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

    // Wallet refund
    const walletResult = await creditWallet(
      booking.userId,
      refundAmount,
      'CREDIT_REFUND',
      `Admin refund: ${reason.trim()}`,
      bookingId,
    );

    const refund = await prisma.$transaction(async (tx) => {
      const newRefund = await tx.refund.create({
        data: {
          bookingId,
          paymentId: payment.id,
          amount: refundAmount,
          method: 'WALLET',
          status: 'PROCESSED',
          reason: reason.trim(),
          walletTransactionId: walletResult.transactionId,
          initiatedById: user.id,
        },
      });

      const totalRefunded = alreadyRefunded + refundAmount;
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: totalRefunded >= payment.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
          refundAmount: totalRefunded,
          refundedAt: new Date(),
          refundMethod: 'WALLET',
        },
      });

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
