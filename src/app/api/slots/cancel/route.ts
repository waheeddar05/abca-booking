import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';
import { getISTTime, formatIST } from '@/lib/time';
import { isBefore } from 'date-fns';
import { notifyBookingCancelled, notifyOperatorBookingCancelled } from '@/lib/notifications';
import { MACHINES } from '@/lib/constants';
import {
  adjustSiblingPricesForCancellation,
  processCancellationRefund,
  type CancellationRefundResult,
} from '@/lib/booking-cancellation';
import { log } from '@/lib/logger';

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

    // Structured log context — one search by email pulls the whole
    // cancellation + refund history for support investigations.
    const ctx = {
      op: user.role === 'ADMIN' ? 'booking.cancel.admin' : 'booking.cancel.user',
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      centerId: booking?.centerId ?? null,
      bookingId,
      extra: {
        bookingPrice: booking?.price ?? null,
        paymentMethod: booking?.paymentMethod ?? null,
        category: booking?.category ?? null,
      },
    } as const;

    if (!booking) {
      log.warn(ctx, 'Booking not found');
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }

    if (booking.userId !== userId && user.role !== 'ADMIN') {
      log.warn(ctx, `Ownership mismatch: booking.userId=${booking.userId}`);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // User side: Users should NOT be able to cancel sessions that are already in the past
    if (user.role !== 'ADMIN') {
      const now = getISTTime();
      if (isBefore(booking.startTime, now)) {
        log.warn(ctx, 'Refused: cannot cancel past session');
        return NextResponse.json({ error: 'Cannot cancel past sessions' }, { status: 400 });
      }
    }

    const cancelledByName = user.name || user.id;
    const cancelReason = cancellationReason || (
      user.role === 'ADMIN'
        ? `Cancelled by Admin (${cancelledByName})`
        : `Cancelled by User (${cancelledByName})`
    );

    log.info(ctx, `Cancel start — reason: ${cancelReason}`);

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

    // ─── Consecutive Pricing Adjustment ──────────────────────────────
    // When cancelling a booking that was part of a consecutive chain,
    // reprice the remaining siblings (they lose the chain discount) and
    // claw the difference back from the user's refund. Works for both
    // ABCA (MACHINE_PITCH) and Toplay (RESOURCE_BASED) via the shared
    // helper. Mutates booking.price in-place when an adjustment lands.
    const consecutiveAdjustment = await adjustSiblingPricesForCancellation(booking);
    if (consecutiveAdjustment > 0) {
      log.info(
        { ...ctx, extra: { ...ctx.extra, consecutiveAdjustment, refundablePrice: booking.price } },
        'Sibling reprice applied',
      );
    }

    // ─── Refund (delegates to shared helper in booking-cancellation) ──
    let refundResult: CancellationRefundResult | null = null;
    try {
      refundResult = await processCancellationRefund({
        booking,
        initiatedByUserId: user.id,
        initiatedByName: cancelledByName,
        requestedRefundMethod:
          requestedRefundMethod === 'WALLET' || requestedRefundMethod === 'RAZORPAY'
            ? requestedRefundMethod
            : undefined,
      });
      if (refundResult) {
        log.info(
          { ...ctx, op: 'payment.refund', amount: refundResult.amount, extra: { ...ctx.extra, refundMethod: refundResult.method } },
          `Refund processed (${refundResult.method})`,
        );
      }
    } catch (refundErr) {
      log.error(ctx, 'Refund failed (booking still cancelled)', refundErr);
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
          message: lines.join(' | '),
          mobileNumber: notifUser?.mobileVerified ? notifUser.mobileNumber : null,
          refundInfo,
        });
      }
    } catch (notifErr) {
      log.error(ctx, 'Cancellation notification failed', notifErr);
    }

    // ─── Notify Assigned Operator about Cancellation ──────────────────
    try {
      if (booking.operatorId) {
        const dateStr = formatIST(new Date(booking.date), 'EEE, dd MMM yyyy');
        const timeStr = formatIST(new Date(booking.startTime), 'hh:mm a');
        const endStr = formatIST(new Date(booking.endTime), 'hh:mm a');
        const machineName = booking.machineId
          ? (MACHINES[booking.machineId as keyof typeof MACHINES]?.shortName || booking.machineId)
          : booking.ballType;

        await notifyOperatorBookingCancelled(bookingId, {
          customerName: booking.playerName,
          date: dateStr,
          time: `${timeStr} – ${endStr}`,
          machine: machineName,
          cancelledBy: cancelledByName,
          reason: cancellationReason || undefined,
        });
      }
    } catch (opNotifErr) {
      log.error(ctx, 'Failed to notify operator about cancellation', opNotifErr);
    }

    log.info({ ...ctx, extra: { ...ctx.extra, refundMethod: refundResult?.method ?? 'NONE', refundAmount: refundResult?.amount ?? 0 } }, 'Cancellation complete');

    return NextResponse.json({ message: 'Booking cancelled', refund: refundResult });
  } catch (error) {
    log.error({ op: 'booking.cancel' }, 'Unhandled error', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
