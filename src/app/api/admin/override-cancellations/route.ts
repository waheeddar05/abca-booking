import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireCenterAdmin } from '@/lib/adminAuth';
import { getTimeSlab, getTimeSlabConfig, timeToMinutes } from '@/lib/pricing';
import { creditWallet } from '@/lib/wallet';
import { notifyBookingCancelled, notifyWalletCredit, notifyAssignedStaffBookingCancelled } from '@/lib/notifications';

interface OverrideRange {
  from: string;
  to: string;
  morning?: number;
  evening?: number;
  recurringDays?: number[]; // 0=Sun..6=Sat; empty/undefined = every day in range
  startTime?: string;       // "HH:MM" IST — time-window override start (inclusive)
  endTime?: string;         // "HH:MM" IST — time-window override end (exclusive)
  count?: number;           // operator count for the time window
}

// A zero-operator range to cancel against — either a whole slab or a
// specific time window within the date range.
type ZeroRange = {
  from: string;
  to: string;
  recurringDays?: number[];
  label: string;
} & (
  | { kind: 'slab'; slab: 'morning' | 'evening' }
  | { kind: 'window'; startMin: number; endMin: number }
);

/**
 * POST /api/admin/override-cancellations
 *
 * When operator date overrides are saved with 0 operators for a slab,
 * automatically cancel all existing BOOKED bookings in those date ranges
 * for the affected time slab, refund to wallets, and notify users.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireCenterAdmin(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Get admin user ID for refund records
    const adminUser = await prisma.user.findUnique({
      where: { email: session.user.email! },
      select: { id: true },
    });
    if (!adminUser) {
      return NextResponse.json({ error: 'Admin user not found' }, { status: 403 });
    }

    const { overrides } = (await req.json()) as { overrides: OverrideRange[] };

    if (!Array.isArray(overrides)) {
      return NextResponse.json({ error: 'Invalid overrides format' }, { status: 400 });
    }

    // Collect zero-operator ranges — slab-wide or time-window.
    const zeroRanges: ZeroRange[] = [];
    for (const range of overrides) {
      const isWindow = range.startTime && range.endTime && typeof range.count === 'number';
      if (isWindow) {
        if (range.count === 0) {
          zeroRanges.push({
            from: range.from,
            to: range.to,
            recurringDays: range.recurringDays,
            kind: 'window',
            startMin: timeToMinutes(range.startTime!),
            endMin: timeToMinutes(range.endTime!),
            label: `${range.startTime}–${range.endTime}`,
          });
        }
        continue;
      }
      if (range.morning === 0) {
        zeroRanges.push({ from: range.from, to: range.to, recurringDays: range.recurringDays, kind: 'slab', slab: 'morning', label: 'morning' });
      }
      if (range.evening === 0) {
        zeroRanges.push({ from: range.from, to: range.to, recurringDays: range.recurringDays, kind: 'slab', slab: 'evening', label: 'evening' });
      }
    }

    if (zeroRanges.length === 0) {
      return NextResponse.json({ cancelled: 0, refunded: 0, message: 'No zero-operator slots found' });
    }

    const timeSlabs = await getTimeSlabConfig();

    let totalCancelled = 0;
    let totalRefunded = 0;

    for (const zr of zeroRanges) {
      const { from, to, recurringDays, label } = zr;
      // Build date range — expand from..to into individual UTC dates
      // If recurringDays is set, only include dates matching those days of week
      const dates: Date[] = [];
      const current = new Date(from + 'T00:00:00.000Z');
      const end = new Date(to + 'T00:00:00.000Z');
      const hasRecurringFilter = Array.isArray(recurringDays) && recurringDays.length > 0;
      while (current <= end) {
        if (!hasRecurringFilter || recurringDays!.includes(current.getUTCDay())) {
          dates.push(new Date(current));
        }
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

      // Filter bookings that belong to the affected slab / time window
      const affectedBookings = bookings.filter(booking => {
        if (zr.kind === 'slab') {
          return getTimeSlab(booking.startTime, timeSlabs) === zr.slab;
        }
        const mins = timeToMinutes(
          booking.startTime.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false, hour: '2-digit', minute: '2-digit' }),
        );
        return mins >= zr.startMin && mins < zr.endMin;
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
              cancellationReason: `Operator unavailable — ${label} slot cancelled due to operator schedule override`,
            },
          });

          totalCancelled++;

          // 2. Refund to wallet (if there's a price to refund)
          const refundAmount = booking.price || 0;
          if (refundAmount > 0) {
            const walletResult = await creditWallet(
              userId,
              booking.centerId,
              refundAmount,
              'CREDIT_REFUND',
              `Refund for cancelled ${label} booking on ${booking.date.toISOString().split('T')[0]} — operator unavailable`,
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
              centerId: booking.centerId,
              bookingId: booking.id,
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
            message: `Your booking on ${dateStr} at ${timeStr} has been cancelled as no operator is available for the ${label} slot.${refundAmount > 0 ? ` ₹${refundAmount} has been refunded to your wallet.` : ''}`,
            mobileNumber: user.mobileNumber,
            refundInfo: refundAmount > 0 ? `₹${refundAmount} refunded to wallet` : undefined,
            centerId: booking.centerId,
            bookingId: booking.id,
          }).catch(err => console.warn('[OverrideCancel] Cancellation notification failed:', err));

          // 5. Notify every assigned staff member (operator / coach / specialist)
          await notifyAssignedStaffBookingCancelled(booking.id, {
            cancelledBy: 'Admin',
            reason: 'Operator schedule override — zero operators',
          }).catch(err => console.warn('[OverrideCancel] Staff notification failed:', err));
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
