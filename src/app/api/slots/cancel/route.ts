import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';
import { getISTTime, formatIST } from '@/lib/time';
import { isBefore } from 'date-fns';
import { creditWallet, getDefaultRefundMethod, isWalletEnabled } from '@/lib/wallet';
import { notifyBookingCancelled, notifyWalletCredit } from '@/lib/notifications';
import { MACHINES } from '@/lib/constants';

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = user.id;

    const { bookingId, cancellationReason, refundMethod: requestedRefundMethod } = await req.json();

    if (!bookingId) {
      return NextResponse.json({ error: 'Booking ID is required' }, { status: 400 });
    }

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
    });

    if (!booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }

    if (booking.userId !== userId && user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // User side: Users should NOT be able to cancel sessions that are already in the past
    if (user.role !== 'ADMIN') {
      const now = getISTTime();
      if (isBefore(booking.startTime, now)) {
        return NextResponse.json({ error: 'Cannot cancel past sessions' }, { status: 400 });
      }
    }

    const cancelledByName = user.name || user.id;
    const cancelReason = cancellationReason || (
      user.role === 'ADMIN'
        ? `Cancelled by Admin (${cancelledByName})`
        : `Cancelled by User (${cancelledByName})`
    );

    await prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: 'CANCELLED',
        cancelledBy: cancelledByName,
        cancellationReason: cancelReason,
      },
    });

    // Restore package session if this was a package booking
    const packageBooking = await prisma.packageBooking.findUnique({
      where: { bookingId },
    });

    if (packageBooking) {
      await prisma.userPackage.update({
        where: { id: packageBooking.userPackageId },
        data: {
          usedSessions: { decrement: packageBooking.sessionsUsed },
        },
      });
    }

    // ─── Refund Logic ─────────────────────────────────────────────────
    // Process refund for wallet-paid or online-paid bookings
    let refundResult: {
      method: 'WALLET' | 'RAZORPAY' | null;
      amount: number;
      refundId?: string;
      walletTransactionId?: string;
      newBalance?: number;
    } | null = null;

    try {
      // Case 1: Wallet-paid booking — refund directly to wallet
      if (booking.paymentMethod === 'WALLET' && booking.paymentStatus === 'PAID' && booking.userId && booking.price && booking.price > 0) {
        const walletResult = await creditWallet(
          booking.userId,
          booking.price,
          'CREDIT_REFUND',
          `Refund for cancelled booking`,
          bookingId,
        );

        // Update booking payment status
        await prisma.booking.update({
          where: { id: bookingId },
          data: { paymentStatus: 'UNPAID' },
        });

        refundResult = {
          method: 'WALLET',
          amount: booking.price,
          walletTransactionId: walletResult.transactionId,
          newBalance: walletResult.newBalance,
        };

        // Notify user about wallet credit
        try {
          const notifUser = await prisma.user.findUnique({
            where: { id: booking.userId },
            select: { mobileNumber: true, mobileVerified: true },
          });
          await notifyWalletCredit(booking.userId, {
            amount: booking.price,
            reason: 'Booking cancellation refund',
            newBalance: walletResult.newBalance,
            mobileNumber: notifUser?.mobileVerified ? notifUser.mobileNumber : null,
          });
        } catch (notifErr) {
          console.error('Wallet credit notification failed:', notifErr);
        }
      } else {
        // Case 2: Online payment — check Payment table for Razorpay refund
        const payment = await prisma.payment.findFirst({
          where: {
            bookingIds: { has: bookingId },
            status: 'CAPTURED',
          },
        });

        if (payment?.razorpayPaymentId) {
          // Calculate refund amount (proportional if multiple bookings in same payment)
          const refundAmount = payment.bookingIds.length > 1
            ? payment.amount / payment.bookingIds.length
            : payment.amount;

          // Determine refund method:
          // 1. Explicit request from user/admin
          // 2. Admin-configured default
          // 3. Fallback: WALLET if enabled, otherwise RAZORPAY
          const walletEnabled = await isWalletEnabled();
          let resolvedMethod: 'WALLET' | 'RAZORPAY';

          if (requestedRefundMethod === 'RAZORPAY' || requestedRefundMethod === 'WALLET') {
            resolvedMethod = requestedRefundMethod;
            // If wallet not enabled but requested, fall back to Razorpay
            if (resolvedMethod === 'WALLET' && !walletEnabled) {
              resolvedMethod = 'RAZORPAY';
            }
          } else {
            resolvedMethod = walletEnabled
              ? await getDefaultRefundMethod()
              : 'RAZORPAY';
          }

          if (resolvedMethod === 'WALLET' && booking.userId) {
            // Credit to wallet
            const walletResult = await creditWallet(
              booking.userId,
              refundAmount,
              'CREDIT_REFUND',
              `Refund for cancelled booking`,
              bookingId,
            );

            // Update payment record
            const isFullRefund = payment.bookingIds.length === 1;
            await prisma.payment.update({
              where: { id: payment.id },
              data: {
                status: isFullRefund ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
                refundAmount: { increment: refundAmount },
                refundedAt: new Date(),
                refundMethod: 'WALLET',
              },
            });

            refundResult = {
              method: 'WALLET',
              amount: refundAmount,
              walletTransactionId: walletResult.transactionId,
              newBalance: walletResult.newBalance,
            };

            // Notify user about wallet credit
            try {
              const notifUser = await prisma.user.findUnique({
                where: { id: booking.userId },
                select: { mobileNumber: true, mobileVerified: true },
              });
              await notifyWalletCredit(booking.userId, {
                amount: refundAmount,
                reason: 'Booking cancellation refund',
                newBalance: walletResult.newBalance,
                mobileNumber: notifUser?.mobileVerified ? notifUser.mobileNumber : null,
              });
            } catch (notifErr) {
              console.error('Wallet credit notification failed:', notifErr);
            }
          } else {
            // Razorpay refund
            const { initiateRefund } = await import('@/lib/razorpay');
            const refund = await initiateRefund({
              paymentId: payment.razorpayPaymentId,
              amount: refundAmount,
              notes: { bookingId, cancelledBy: cancelledByName },
            });

            const isFullRefund = payment.bookingIds.length === 1;
            await prisma.payment.update({
              where: { id: payment.id },
              data: {
                status: isFullRefund ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
                refundId: refund.id,
                refundAmount: { increment: refundAmount },
                refundedAt: new Date(),
                refundMethod: 'RAZORPAY',
              },
            });

            refundResult = {
              method: 'RAZORPAY',
              amount: refundAmount,
              refundId: refund.id,
            };
          }
        }
      }
    } catch (refundErr) {
      console.error('Refund failed (booking still cancelled):', refundErr);
    }

    // Send cancellation notification
    try {
      if (booking.userId) {
        const dateStr = formatIST(new Date(booking.date), 'EEE, dd MMM yyyy');
        const timeStr = formatIST(new Date(booking.startTime), 'hh:mm a');
        const endStr = formatIST(new Date(booking.endTime), 'hh:mm a');
        const machineName = booking.machineId
          ? (MACHINES[booking.machineId as keyof typeof MACHINES]?.shortName || booking.machineId)
          : booking.ballType;

        const lines = [
          `${dateStr}`,
          `${timeStr} – ${endStr}`,
          `Machine: ${machineName}`,
          `Cancelled by: ${cancelledByName}`,
        ];
        if (cancelReason) lines.push(`Reason: ${cancelReason}`);

        let refundInfo: string | undefined;
        if (refundResult) {
          refundInfo = refundResult.method === 'WALLET'
            ? `Refund: ₹${refundResult.amount} credited to wallet (Balance: ₹${refundResult.newBalance})`
            : `Refund: ₹${refundResult.amount} will be credited to your bank in 5-7 business days`;
        }

        const notifUser = await prisma.user.findUnique({
          where: { id: booking.userId },
          select: { mobileNumber: true, mobileVerified: true },
        });

        await notifyBookingCancelled(booking.userId, {
          message: lines.join('\n'),
          mobileNumber: notifUser?.mobileVerified ? notifUser.mobileNumber : null,
          refundInfo,
        });
      }
    } catch (notifErr) {
      console.error('Cancellation notification failed:', notifErr);
    }

    return NextResponse.json({ message: 'Booking cancelled', refund: refundResult });
  } catch (error) {
    console.error('Cancel booking error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
