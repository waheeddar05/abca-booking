import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';
import { getISTTime, formatIST } from '@/lib/time';
import { isBefore } from 'date-fns';
import { creditWallet, getDefaultRefundMethod, isWalletEnabled } from '@/lib/wallet';
import { notifyBookingCancelled, notifyWalletCredit, notifyOperatorBookingCancelled } from '@/lib/notifications';
import { MACHINES, getBallTypeForMachine, MACHINE_A_BALLS } from '@/lib/constants';
import { calculateNewPricing, getPricingConfig, getTimeSlabConfig } from '@/lib/pricing';

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

    // ─── Consecutive Pricing Adjustment ──────────────────────────────
    // When cancelling a booking that was part of a consecutive group,
    // recalculate sibling prices (including recurring slot discounts) and
    // adjust the refund accordingly.
    // e.g. If 2 consecutive slots cost ₹800 (₹400 each) and single is ₹500,
    //   cancelling one should refund ₹300 (not ₹400) and reprice sibling to ₹500.
    let consecutiveAdjustment = 0; // Amount to subtract from refund due to sibling repricing

    try {
      // Check for consecutive siblings regardless of discountAmount — the
      // discount field may be null for older bookings but the pricing gap
      // still needs to be clawed back on cancellation.
      if (booking.machineId && booking.userId) {
        // Find active sibling bookings on the same date, machine, and pitch
        const siblingBookings = await prisma.booking.findMany({
          where: {
            id: { not: bookingId },
            userId: booking.userId,
            date: booking.date,
            machineId: booking.machineId,
            pitchType: booking.pitchType,
            status: 'BOOKED',
          },
          orderBy: { startTime: 'asc' },
        });

        if (siblingBookings.length > 0) {
          // Recalculate pricing for remaining slots (without the cancelled one)
          const ballType = booking.ballType || getBallTypeForMachine(booking.machineId);
          const category: 'MACHINE' | 'TENNIS' = MACHINE_A_BALLS.includes(ballType) ? 'MACHINE' : 'TENNIS';

          const pricingConfig = await getPricingConfig();
          const timeSlabConfig = await getTimeSlabConfig();

          const remainingSlots = siblingBookings.map(b => ({
            startTime: new Date(b.startTime),
            endTime: new Date(b.endTime),
          }));

          const newPricing = calculateNewPricing(
            remainingSlots,
            category,
            ballType,
            booking.pitchType,
            timeSlabConfig,
            pricingConfig,
            booking.machineId
          );

          // ── Re-apply Recurring Slot Discounts to repriced siblings ─────
          // The booking route applies recurring discounts on top of
          // consecutive pricing. We must do the same here so that sibling
          // prices stay correct and the consecutiveAdjustment is accurate.
          const getISTTimeStr = (d: Date): string => {
            const utcMs = d.getTime();
            const istMs = utcMs + (5 * 60 + 30) * 60 * 1000;
            const istDate = new Date(istMs);
            const h = istDate.getUTCHours().toString().padStart(2, '0');
            const m = istDate.getUTCMinutes().toString().padStart(2, '0');
            return `${h}:${m}`;
          };
          const getISTDay = (d: Date): number => {
            const utcMs = d.getTime();
            const istMs = utcMs + (5 * 60 + 30) * 60 * 1000;
            return new Date(istMs).getUTCDay();
          };

          let recurringDiscountRules: Array<any> = [];
          try {
            recurringDiscountRules = await prisma.recurringSlotDiscount.findMany({
              where: { enabled: true },
            });
          } catch {
            // Table may not exist; skip recurring discounts
          }

          const isRemainingConsecutive = remainingSlots.length >= 2;
          const perSlotDiscountKey = isRemainingConsecutive ? 'twoSlotDiscount' : 'oneSlotDiscount';

          for (let i = 0; i < newPricing.length; i++) {
            const slotStart = remainingSlots[i].startTime;
            const dayOfWeek = getISTDay(slotStart);
            const istTimeStr = getISTTimeStr(slotStart);

            for (const rule of recurringDiscountRules) {
              if (!rule.days.includes(dayOfWeek)) continue;
              const ruleStartTime = rule.slotStartTime.padStart(5, '0');
              const ruleEndTime = (rule.slotEndTime || rule.slotStartTime).padStart(5, '0');
              if (istTimeStr < ruleStartTime || istTimeStr >= ruleEndTime) continue;
              if (rule.machineIds && rule.machineIds.length > 0 && booking.machineId && !rule.machineIds.includes(booking.machineId)) continue;

              const discountAmt = rule[perSlotDiscountKey] as number;
              const maxReduction = Math.min(discountAmt, newPricing[i].price);
              newPricing[i].price = Math.max(0, newPricing[i].price - maxReduction);
              newPricing[i].discountAmount += maxReduction;
              break; // first matching rule wins
            }
          }

          // Update sibling bookings with new prices and accumulate price increases.
          // ONLY update when new price is HIGHER — never lower a sibling's price,
          // as that would change the amount the user already paid and misalign
          // booking history, CSV exports, and admin views.
          for (let i = 0; i < siblingBookings.length; i++) {
            const sibling = siblingBookings[i];
            const newPrice = newPricing[i].price;
            const oldPrice = sibling.price || 0;
            const priceIncrease = newPrice - oldPrice;

            console.log(`[Cancel] Sibling ${sibling.id}: oldPrice=${oldPrice}, newPrice=${newPrice}, increase=${priceIncrease}, discount=${newPricing[i].discountAmount}`);

            if (priceIncrease > 0) {
              consecutiveAdjustment += priceIncrease;

              await prisma.booking.update({
                where: { id: sibling.id },
                data: {
                  price: newPrice,
                  originalPrice: newPricing[i].originalPrice,
                  discountAmount: newPricing[i].discountAmount > 0 ? newPricing[i].discountAmount : null,
                  discountType: newPricing[i].discountAmount > 0 ? 'FIXED' : null,
                },
              });
            }
          }
        }
      }
      // Update the cancelled booking's price to the adjusted amount so that
      // refund status displays correctly (totalRefunded >= price → "Refunded")
      if (consecutiveAdjustment > 0 && booking.price) {
        const adjustedBookingPrice = Math.max(0, booking.price - consecutiveAdjustment);
        console.log(`[Cancel] Booking ${bookingId}: paidPrice=${booking.price}, adjustment=${consecutiveAdjustment}, refundablePrice=${adjustedBookingPrice}`);
        await prisma.booking.update({
          where: { id: bookingId },
          data: { price: adjustedBookingPrice },
        });
        // Update local reference so refund logic uses the adjusted price
        booking.price = adjustedBookingPrice;
      }
    } catch (adjustErr) {
      console.error('Consecutive pricing adjustment failed:', adjustErr);
      // Continue with standard refund if adjustment fails
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
      // Check how much has already been refunded for this booking
      const existingRefunds = await prisma.refund.findMany({
        where: { bookingId, status: { not: 'FAILED' } },
      });
      const alreadyRefunded = existingRefunds.reduce((sum, r) => sum + r.amount, 0);
      console.log(`[Cancel] Refund calc for ${bookingId}: bookingPrice=${booking.price}, paymentMethod=${booking.paymentMethod}, alreadyRefunded=${alreadyRefunded}, consecutiveAdj=${consecutiveAdjustment}`);

      // Case 1: Wallet-paid booking — refund remaining to wallet
      if (booking.paymentMethod === 'WALLET' && booking.paymentStatus === 'PAID' && booking.userId && booking.price && booking.price > 0) {
        // booking.price is already adjusted for consecutive repricing above
        const remainingRefund = booking.price - alreadyRefunded;

        if (remainingRefund > 0) {
          const walletResult = await creditWallet(
            booking.userId,
            booking.centerId,
            remainingRefund,
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
            amount: remainingRefund,
            walletTransactionId: walletResult.transactionId,
            newBalance: walletResult.newBalance,
          };

          // Create Refund record so the refund button is correctly disabled
          await prisma.refund.create({
            data: {
              bookingId,
              amount: remainingRefund,
              method: 'WALLET',
              status: 'PROCESSED',
              reason: `Auto-refund: booking cancelled by ${cancelledByName}`,
              walletTransactionId: walletResult.transactionId,
              initiatedById: user.id,
            },
          });

          // Notify user about wallet credit
          try {
            const notifUser = await prisma.user.findUnique({
              where: { id: booking.userId },
              select: { mobileNumber: true, mobileVerified: true },
            });
            await notifyWalletCredit(booking.userId, {
              amount: remainingRefund,
              reason: 'Booking cancellation refund',
              newBalance: walletResult.newBalance,
              mobileNumber: notifUser?.mobileVerified ? notifUser.mobileNumber : null,
            });
          } catch (notifErr) {
            console.error('Wallet credit notification failed:', notifErr);
          }
        } else {
          // Already fully refunded — just update payment status
          await prisma.booking.update({
            where: { id: bookingId },
            data: { paymentStatus: 'UNPAID' },
          });
        }
      } else {
        // Case 2: Online payment — check Payment table for Razorpay refund
        const payment = await prisma.payment.findFirst({
          where: {
            bookingIds: { has: bookingId },
            status: { in: ['CAPTURED', 'PARTIALLY_REFUNDED'] },
          },
        });

        if (payment?.razorpayPaymentId) {
          // Use the booking's actual price instead of splitting payment equally —
          // bookings may have different prices due to consecutive discounts.
          // booking.price is already adjusted for consecutive repricing above.
          const fullRefundAmount = (booking.price && booking.price > 0) ? booking.price : (
            payment.bookingIds.length > 1
              ? payment.amount / payment.bookingIds.length
              : payment.amount
          );
          const remainingRefund = fullRefundAmount - alreadyRefunded;

          if (remainingRefund > 0) {
            // Determine refund method:
            // 1. Explicit request from user/admin
            // 2. Admin-configured default
            // 3. Fallback: WALLET if enabled, otherwise RAZORPAY
            const walletEnabled = await isWalletEnabled(booking.centerId);
            let resolvedMethod: 'WALLET' | 'RAZORPAY';

            if (requestedRefundMethod === 'RAZORPAY' || requestedRefundMethod === 'WALLET') {
              resolvedMethod = requestedRefundMethod;
              // If wallet not enabled but requested, fall back to Razorpay
              if (resolvedMethod === 'WALLET' && !walletEnabled) {
                resolvedMethod = 'RAZORPAY';
              }
            } else {
              resolvedMethod = walletEnabled
                ? await getDefaultRefundMethod(booking.centerId)
                : 'RAZORPAY';
            }

            if (resolvedMethod === 'WALLET' && booking.userId) {
              // Credit to wallet (booking's own center)
              const walletResult = await creditWallet(
                booking.userId,
                booking.centerId,
                remainingRefund,
                'CREDIT_REFUND',
                `Refund for cancelled booking`,
                bookingId,
              );

              // Update payment record
              const totalRefundedOnPayment = (payment.refundAmount || 0) + remainingRefund;
              const isFullPaymentRefund = totalRefundedOnPayment >= payment.amount;
              await prisma.payment.update({
                where: { id: payment.id },
                data: {
                  status: isFullPaymentRefund ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
                  refundAmount: { increment: remainingRefund },
                  refundedAt: new Date(),
                  refundMethod: 'WALLET',
                },
              });

              refundResult = {
                method: 'WALLET',
                amount: remainingRefund,
                walletTransactionId: walletResult.transactionId,
                newBalance: walletResult.newBalance,
              };

              // Create Refund record so the refund button is correctly disabled
              await prisma.refund.create({
                data: {
                  bookingId,
                  paymentId: payment.id,
                  amount: remainingRefund,
                  method: 'WALLET',
                  status: 'PROCESSED',
                  reason: `Auto-refund: booking cancelled by ${cancelledByName}`,
                  walletTransactionId: walletResult.transactionId,
                  initiatedById: user.id,
                },
              });

              // Notify user about wallet credit
              try {
                const notifUser = await prisma.user.findUnique({
                  where: { id: booking.userId },
                  select: { mobileNumber: true, mobileVerified: true },
                });
                await notifyWalletCredit(booking.userId, {
                  amount: remainingRefund,
                  reason: 'Booking cancellation refund',
                  newBalance: walletResult.newBalance,
                  mobileNumber: notifUser?.mobileVerified ? notifUser.mobileNumber : null,
                });
              } catch (notifErr) {
                console.error('Wallet credit notification failed:', notifErr);
              }
            } else {
              // Razorpay refund — use the originating center's account.
              const { initiateRefund } = await import('@/lib/razorpay');
              const refund = await initiateRefund({
                centerId: booking.centerId,
                paymentId: payment.razorpayPaymentId,
                amount: remainingRefund,
                notes: { bookingId, cancelledBy: cancelledByName },
              });

              const totalRefundedOnPayment = (payment.refundAmount || 0) + remainingRefund;
              const isFullPaymentRefund = totalRefundedOnPayment >= payment.amount;
              await prisma.payment.update({
                where: { id: payment.id },
                data: {
                  status: isFullPaymentRefund ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
                  refundId: refund.id,
                  refundAmount: { increment: remainingRefund },
                  refundedAt: new Date(),
                  refundMethod: 'RAZORPAY',
                },
              });

              refundResult = {
                method: 'RAZORPAY',
                amount: remainingRefund,
                refundId: refund.id,
              };

              // Create Refund record so the refund button is correctly disabled
              await prisma.refund.create({
                data: {
                  bookingId,
                  paymentId: payment.id,
                  amount: remainingRefund,
                  method: 'RAZORPAY',
                  status: 'INITIATED',
                  reason: `Auto-refund: booking cancelled by ${cancelledByName}`,
                  razorpayRefundId: refund.id,
                  initiatedById: user.id,
                },
              });
            }
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
          message: lines.join(' | '),
          mobileNumber: notifUser?.mobileVerified ? notifUser.mobileNumber : null,
          refundInfo,
        });
      }
    } catch (notifErr) {
      console.error('Cancellation notification failed:', notifErr);
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
      console.error('Failed to notify operator about cancellation:', opNotifErr);
    }

    return NextResponse.json({ message: 'Booking cancelled', refund: refundResult });
  } catch (error) {
    console.error('Cancel booking error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
