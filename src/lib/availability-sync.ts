import { prisma } from '@/lib/prisma';
import { getISTTime, formatIST } from '@/lib/time';
import { slotMatchesMembershipAvailability, type AvailabilityWindow } from '@/lib/resource-booking';
import { adjustSiblingPricesForCancellation, processCancellationRefund } from '@/lib/booking-cancellation';
import { notifyBookingCancelled, notifyAssignedStaffBookingCancelled } from '@/lib/notifications';
import { log } from '@/lib/logger';

/**
 * Builds the Prisma `where` fragment that selects only the bookings tied to
 * the role whose availability is being updated. A user can hold both the
 * COACH and SIDEARM_SPECIALIST memberships at the same center; updating the
 * availability of one role must never reach into the other role's bookings.
 * Each membership stores its schedule independently, so conflicts are
 * evaluated per role (and then per slot via slotMatchesMembershipAvailability).
 *
 * Returns `null` for roles that don't carry bookable assignments (e.g. ADMIN),
 * meaning there are no bookings to impact.
 */
function bookingAssignmentFilter(membership: { userId: string; role: string }) {
  switch (membership.role) {
    case 'COACH':
      return { assignedCoachId: membership.userId };
    case 'SIDEARM_SPECIALIST':
      return { assignedStaffId: membership.userId };
    // GROUND_STAFF is a non-exclusive floor contact, not a booked
    // resource — changing their availability must NOT cancel or refund
    // the facility bookings they're listed on. Returning null means the
    // availability editor reports "0 impacted bookings" and the save
    // proceeds without touching any booking, which is the intended
    // behaviour for ground staff (and ADMIN / OPERATOR).
    case 'GROUND_STAFF':
    default:
      return null;
  }
}

/**
 * Returns the list of future bookings that would be cancelled if the
 * availability was updated to the provided new schedules.
 */
export async function getImpactedBookings(opts: {
  membershipId: string;
  centerId: string;
  newWeekly?: AvailabilityWindow[];
}) {
  const { membershipId, centerId, newWeekly } = opts;

  const membership = await prisma.centerMembership.findUnique({
    where: { id: membershipId },
    select: { userId: true, role: true },
  });
  if (!membership) return [];

  const assignmentFilter = bookingAssignmentFilter(membership);
  if (!assignmentFilter) return [];

  const now = getISTTime();
  const bookings = await prisma.booking.findMany({
    where: {
      centerId,
      status: 'BOOKED',
      startTime: { gte: now },
      ...assignmentFilter,
    },
    select: {
      id: true,
      date: true,
      startTime: true,
      endTime: true,
    },
  });

  if (bookings.length === 0) return [];

  const impacted = bookings.filter((booking) => {
    const slot = {
      date: new Date(booking.date),
      startTime: new Date(booking.startTime),
      endTime: new Date(booking.endTime),
    };
    return !slotMatchesMembershipAvailability(slot, newWeekly || []);
  });

  return impacted;
}

/**
 * Checks for future bookings of a coach/staff member that are no longer
 * compatible with their updated availability, cancels them, and issues
 * a wallet refund.
 */
export async function autoCancelImpactedBookings(opts: {
  membershipId: string;
  centerId: string;
  adminUserId: string;
  adminName: string;
  newWeekly?: AvailabilityWindow[];
}) {
  const { membershipId, centerId, adminUserId, adminName, newWeekly } = opts;

  // 1. Resolve the membership to get the user ID
  const membership = await prisma.centerMembership.findUnique({
    where: { id: membershipId },
    select: { userId: true, role: true },
  });
  if (!membership) return;

  const assignmentFilter = bookingAssignmentFilter(membership);
  if (!assignmentFilter) return;

  // 2. Fetch future BOOKED bookings assigned to this member *in this role*
  const now = getISTTime();
  const bookings = await prisma.booking.findMany({
    where: {
      centerId,
      status: 'BOOKED',
      startTime: { gte: now },
      ...assignmentFilter,
    },
  });

  if (bookings.length === 0) return;

  // 3. For each booking, check if it fits the NEW availability
  for (const booking of bookings) {
    const slot = {
      date: new Date(booking.date),
      startTime: new Date(booking.startTime),
      endTime: new Date(booking.endTime),
    };

    const isStillAvailable = slotMatchesMembershipAvailability(slot, newWeekly || []);

    if (!isStillAvailable) {
      await cancelAndRefundBooking({
        booking,
        adminUserId,
        adminName,
      });
    }
  }
}

async function cancelAndRefundBooking(opts: {
  booking: any;
  adminUserId: string;
  adminName: string;
}) {
  const { booking, adminUserId, adminName } = opts;
  const ctx = {
    op: 'booking.autocancel.availability_change',
    bookingId: booking.id,
    userId: booking.userId,
    centerId: booking.centerId,
  };

  try {
    const cancelReason = `Cancelled due to change in specialist availability (Admin: ${adminName})`;

    // Cancel the booking
    await prisma.booking.update({
      where: { id: booking.id },
      data: {
        status: 'CANCELLED',
        cancelledBy: adminName,
        cancellationReason: cancelReason,
      },
    });

    // Reprice siblings if needed
    await adjustSiblingPricesForCancellation(booking);

    // Refund to wallet (default behavior for admin-initiated auto-cancel)
    const refundResult = await processCancellationRefund({
      booking,
      initiatedByUserId: adminUserId,
      initiatedByName: adminName,
      requestedRefundMethod: 'WALLET',
    });

    // Notify user
    if (booking.userId) {
      const dateStr = formatIST(new Date(booking.date), 'EEE, dd MMM yyyy');
      const timeStr = formatIST(new Date(booking.startTime), 'hh:mm a');
      const endStr = formatIST(new Date(booking.endTime), 'hh:mm a');

      const lines = [
        `Specialist Availability Changed`,
        `${dateStr} | ${timeStr} – ${endStr}`,
        `Reason: ${cancelReason}`,
      ];

      let refundInfo: string | undefined;
      if (refundResult) {
        refundInfo = refundResult.method === 'WALLET'
          ? `Refund: ₹${refundResult.amount} credited to wallet (Balance: ₹${refundResult.newBalance})`
          : `Refund: ₹${refundResult.amount} will be credited to your bank`;
      }

      const user = await prisma.user.findUnique({
        where: { id: booking.userId },
        select: { mobileNumber: true, mobileVerified: true },
      });

      await notifyBookingCancelled(booking.userId, {
        message: lines.join(' | '),
        mobileNumber: user?.mobileVerified ? user.mobileNumber : null,
        refundInfo,
        centerId: booking.centerId,
        bookingId: booking.id,
      });
    }

    // Notify the assigned service provider(s) — operator / coach / sidearm
    // specialist / ground staff — that their session was auto-cancelled.
    await notifyAssignedStaffBookingCancelled(booking.id, {
      cancelledBy: adminName,
      reason: cancelReason,
    });

    log.info(ctx, `Auto-cancelled booking ${booking.id} due to availability change`);
  } catch (err) {
    log.error(ctx, `Failed to auto-cancel booking ${booking.id}`, err);
  }
}
