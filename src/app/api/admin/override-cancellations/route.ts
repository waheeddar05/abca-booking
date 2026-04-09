import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/adminAuth';
import { getTimeSlab, getTimeSlabConfig } from '@/lib/pricing';
import { creditWallet } from '@/lib/wallet';
import { notifyBookingCancelled, notifyWalletCredit, notifyOperatorBookingCancelled } from '@/lib/notifications';

interface OverrideRange {
  from: string;
  to: string;
  morning: number;
  evening: number;
}

/**
 * POST /api/admin/override-cancellations
 *
 * When operator date overrides are saved with 0 operators for a slab,
 * automatically cancel all existing BOOKED bookings in those date ranges
 * for the affected time slab, refund to wallets, and notify users.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireAdmin(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Get admin user ID for refund records
    const adminUser = await prisma.user.findUnique({
      where: { email: session.email! },
      select: { id: true },
    });
    if (!adminUser) {
      return NextResponse.json({ error: 'Admin user not found' }, { status: 403 });
    }

    const { overrides } = (await req.json()) as { overrides: OverrideRange[] };

    if (!Array.isArray(overrides)) {
      return NextResponse.json({ error: 'Invalid overrides format' }, { status: 400 });
    }

    // Find ranges where morning=0 or evening=0
    const zeroSlabRanges: Array<{ from: string; to: string; slab: 'morning' | 'evening' }> = [];
    for (const range of overrides) {
      if (range.morning === 0) {
        zeroSlabRanges.push({ from: range.from, to: range.to, slab: 'morning' });
      }
      if (range.evening === 0) {
        zeroSlabRanges.push({ from: range.from, to: range.to, slab: 'evening' });
      }
    }

    if (zeroSlabRanges.length === 0) {
      return NextResponse.json({ cancelled: 0, refunded: 0, message: 'No zero-operator slots found' });
    }

    const timeSlabs = await getTimeSlabConfig();

    let totalCancelled = 0;
    let totalRefunded = 0;

    for (const { from, to, slab } of zeroSlabRanges) {
      // Build date range — expand from..to into individual UTC dates
      const dates: Date[] = [];
      const current = new Date(from + 'T00:00:00.000Z');
      const end = new Date(to + 'T00:00:00.000Z');
      while (current <= end) {
        dates.push(new Date(current));
        current.setUTCDate(current.getUTCDate() + 1);
      }

      if (dates.length === 0) continue;

      // Find all BOOKED bookings in this date range (only those with a user)
      const bookings = await prisma.booking.findMany({
        where: {
          date: { in: dates },
          status: 'BOOKED',
          operationMode: 'WITH_OPERATOR',
          userId: { not: null },
        },
        include: {
          user: { select: { id: true, name: true, mobileNumber: true } },
        },
      });

      // Filter bookings that belong to the affected slab
      const affectedBookings = bookings.filter(booking => {
        const bookingSlab = getTimeSlab(booking.startTime, timeSlabs);
        return bookingSlab === slab;
      });

      if (affectedBookings.length === 0) continue;

      // Cancel each booking, refund to wallet, and notify
      for (const booking of affectedBookings) {
        const userId = booking.userId!;
        const user = booking.user!;

        try {
          // 1. Cancel the booking
          await prisma.booking.update({
            where: { id: booking.id },
            data: {
              status: 'CANCELLED',
              cancelledBy: 'ADMIN',
              cancellationReason: `Operator unavailable — ${slab} slot cancelled due to operator schedule override`,
            },
          });

          totalCancelled++;

          // 2. Refund to wallet (if there's a price to refund)
          const refundAmount = booking.price || 0;
          if (refundAmount > 0) {
            const walletResult = await creditWallet(
              userId,
              refundAmount,
              'CREDIT_REFUND',
              `Refund for cancelled ${slab} booking on ${booking.date.toISOString().split('T')[0]} — operator unavailable`,
              booking.id,
            );

            // Create refund record
            await prisma.refund.create({
              data: {
                bookingId: booking.id,
                amount: refundAmount,
                method: 'WALLET',
                status: 'PROCESSED',
                reason: 'Operator schedule override — zero operators',
                walletTransactionId: walletResult.transactionId,
                initiatedById: adminUser.id,
              },
            });

            totalRefunded++;

            // 3. Notify about wallet credit
            await notifyWalletCredit(userId, {
              amount: refundAmount,
              reason: 'Booking cancelled — operator unavailable',
              newBalance: walletResult.newBalance,
              mobileNumber: user.mobileNumber,
            }).catch(err => console.warn('[OverrideCancel] Wallet notification failed:', err));
          }

          // 4. Notify about booking cancellation
          const dateStr = booking.date.toISOString().split('T')[0];
          const timeStr = booking.startTime.toLocaleTimeString('en-IN', {
            timeZone: 'Asia/Kolkata',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
          });

          await notifyBookingCancelled(userId, {
            message: `Your booking on ${dateStr} at ${timeStr} has been cancelled as no operator is available for the ${slab} slot.${refundAmount > 0 ? ` ₹${refundAmount} has been refunded to your wallet.` : ''}`,
            mobileNumber: user.mobileNumber,
            refundInfo: refundAmount > 0 ? `₹${refundAmount} refunded to wallet` : undefined,
          }).catch(err => console.warn('[OverrideCancel] Cancellation notification failed:', err));

          // 5. Notify operator if assigned
          if (booking.operatorId) {
            await notifyOperatorBookingCancelled(booking.id, {
              customerName: user.name || 'Customer',
              date: dateStr,
              time: timeStr,
              machine: booking.machineId || 'Unknown',
              cancelledBy: 'Admin',
              reason: 'Operator schedule override — zero operators',
            }).catch(err => console.warn('[OverrideCancel] Operator notification failed:', err));
          }
        } catch (err) {
          console.error(`[OverrideCancel] Failed to cancel booking ${booking.id}:`, err);
          // Continue with other bookings
        }
      }
    }

    return NextResponse.json({
      cancelled: totalCancelled,
      refunded: totalRefunded,
      message: totalCancelled > 0
        ? `${totalCancelled} booking(s) cancelled and ${totalRefunded} refund(s) processed`
        : 'No active bookings found for the affected slots',
    });
  } catch (error) {
    console.error('[OverrideCancel] Error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
