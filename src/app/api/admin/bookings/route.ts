import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireCenterAdmin } from '@/lib/adminAuth';
import { getAuthenticatedUser } from '@/lib/auth';
import { resolveCurrentCenter } from '@/lib/centers';
import { getISTTodayUTC, getISTLastMonthRange, dateStringToUTC, formatIST } from '@/lib/time';
import { MACHINES } from '@/lib/constants';
import { notifyBookingCancelled, notifyOperatorBookingCancelled } from '@/lib/notifications';
import { autoAssignOperator } from '@/lib/operatorAssign';
import {
  adjustSiblingPricesForCancellation,
  processCancellationRefund,
} from '@/lib/booking-cancellation';
import { log } from '@/lib/logger';

type MachineIdFilter = 'GRAVITY' | 'YANTRA' | 'LEVERAGE_INDOOR' | 'LEVERAGE_OUTDOOR';

const SAFE_BOOKING_SELECT = {
  id: true,
  userId: true,
  date: true,
  startTime: true,
  endTime: true,
  status: true,
  ballType: true,
  playerName: true,
  createdAt: true,
  createdBy: true,
  price: true,
  originalPrice: true,
  discountAmount: true,
  paymentMethod: true,
  paymentStatus: true,
  machineId: true,
  pitchType: true,
  operationMode: true,
  operatorId: true,
  cancelledBy: true,
  cancellationReason: true,
  isSuperAdminBooking: true,
  kitRental: true,
  kitRentalCharge: true,
  user: { select: { name: true, email: true, mobileNumber: true } },
} as const;

export async function GET(req: NextRequest) {
  try {
    const session = await requireCenterAdmin(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const category = searchParams.get('category');
    const date = searchParams.get('date');
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const status = searchParams.get('status');
    const customer = searchParams.get('customer');
    const userId = searchParams.get('userId');
    const machineId = searchParams.get('machineId');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const sortBy = searchParams.get('sortBy') || 'date';
    const sortOrder = searchParams.get('sortOrder') || 'desc';

    // Scope by the admin's current center. Super admins can pass
    // `?allCenters=true` to view aggregate data across centers — useful
    // for the platform-wide dashboard.
    const allCenters = searchParams.get('allCenters') === 'true';
    const adminUser = await getAuthenticatedUser(req);
    const center = adminUser ? await resolveCurrentCenter(req, adminUser) : null;

    const where: any = {};
    if (!allCenters && center) {
      where.centerId = center.id;
    } else if (!allCenters && !center) {
      return NextResponse.json({ error: 'No center selected' }, { status: 400 });
    } else if (allCenters && !adminUser?.isSuperAdmin) {
      return NextResponse.json({ error: 'allCenters requires super admin' }, { status: 403 });
    }
    const todayUTC = getISTTodayUTC();

    if (category === 'today') {
      where.date = todayUTC;
    } else if (category === 'upcoming') {
      where.date = { gt: todayUTC };
      where.status = 'BOOKED';
    } else if (category === 'previous') {
      where.date = { lt: todayUTC };
    } else if (category === 'lastMonth') {
      const lastMonthRange = getISTLastMonthRange();
      where.date = {
        gte: lastMonthRange.start,
        lte: lastMonthRange.end,
      };
    }

    if (date) {
      where.date = dateStringToUTC(date);
    } else if (from && to) {
      where.date = {
        gte: dateStringToUTC(from),
        lte: dateStringToUTC(to),
      };
    }

    // Save base where for summary counts (before status-derived time constraints)
    const summaryBaseWhere = JSON.parse(JSON.stringify(where));
    const now = new Date();

    // Status filter: IN_PROGRESS, DONE, BOOKED(Upcoming) are derived statuses
    // not stored in DB — computed from BOOKED + current time via getDisplayStatus()
    if (status === 'IN_PROGRESS') {
      where.status = 'BOOKED';
      where.startTime = { lte: now };
      where.endTime = { gt: now };
    } else if (status === 'BOOKED') {
      where.status = 'BOOKED';
      where.startTime = { gt: now };
    } else if (status === 'DONE') {
      // Completed = BOOKED sessions that have ended, OR explicitly marked DONE in DB
      where.AND = [
        ...(where.AND || []),
        {
          OR: [
            { status: 'DONE' },
            { status: 'BOOKED', endTime: { lte: now } },
          ],
        },
      ];
    } else if (status) {
      where.status = status;
    }

    if (customer) {
      where.OR = [
        { playerName: { contains: customer, mode: 'insensitive' } },
        { user: { name: { contains: customer, mode: 'insensitive' } } },
        { user: { email: { contains: customer, mode: 'insensitive' } } },
      ];
    }

    if (userId) {
      where.userId = userId;
    }

    if (machineId) {
      where.machineId = machineId as MachineIdFilter;
    }

    const orderBy: any = [];
    if (sortBy === 'createdAt') {
      orderBy.push({ createdAt: sortOrder });
    } else {
      orderBy.push({ date: sortOrder });
      orderBy.push({ startTime: sortOrder });
    }

    const skip = (page - 1) * limit;

    // Try full query; fall back to safe select if new columns don't exist yet
    let bookings: any[];
    let total: number;
    try {
      [bookings, total] = await Promise.all([
        prisma.booking.findMany({
          where,
          include: {
            user: { select: { name: true, email: true, mobileNumber: true } },
            packageBooking: {
              select: {
                userPackage: {
                  select: {
                    package: { select: { name: true } },
                  },
                },
              },
            },
            refunds: { select: { id: true, amount: true, method: true, status: true } },
          },
          orderBy,
          skip,
          take: limit,
        }),
        prisma.booking.count({ where }),
      ]);
    } catch {
      [bookings, total] = await Promise.all([
        prisma.booking.findMany({
          where,
          select: SAFE_BOOKING_SELECT,
          orderBy,
          skip,
          take: limit,
        }),
        prisma.booking.count({ where }),
      ]);
    }

    // Summary counts use baseWhere (without status time constraints) + derived status logic
    const [bookedCount, doneCount, cancelledCount] = await Promise.all([
      // "Upcoming" = BOOKED bookings that haven't started yet
      prisma.booking.count({ where: { ...summaryBaseWhere, status: 'BOOKED', startTime: { gt: now } } }),
      // "Completed" = BOOKED sessions that ended + any explicitly DONE
      prisma.booking.count({
        where: {
          AND: [
            summaryBaseWhere,
            {
              OR: [
                { status: 'DONE' },
                { status: 'BOOKED', endTime: { lte: now } },
              ],
            },
          ],
        },
      }),
      prisma.booking.count({ where: { ...summaryBaseWhere, status: 'CANCELLED' } }),
    ]);

    return NextResponse.json({
      bookings,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      summary: {
        booked: bookedCount,
        done: doneCount,
        cancelled: cancelledCount,
        total: bookedCount + doneCount + cancelledCount,
      },
    });
  } catch (error: any) {
    console.error('Admin bookings fetch error:', error);
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireCenterAdmin(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const body = await req.json();
    const { bookingId, status, price, cancellationReason, operatorId } = body;

    if (!bookingId) {
      return NextResponse.json({ error: 'Booking ID is required' }, { status: 400 });
    }

    const authUser = await getAuthenticatedUser(req);
    const adminName = authUser?.name || authUser?.id || 'Admin';

    const data: any = {};

    // Handle operator reassignment
    if (operatorId !== undefined) {
      if (operatorId === null) {
        // Unassign operator
        data.operatorId = null;
      } else {
        // Validate operator exists and has OPERATOR role
        const operator = await prisma.user.findUnique({
          where: { id: operatorId },
          select: { id: true, role: true },
        });
        if (!operator) {
          return NextResponse.json({ error: 'Operator not found' }, { status: 404 });
        }
        if (operator.role !== 'OPERATOR' && operator.role !== 'ADMIN') {
          return NextResponse.json({ error: 'User is not an operator' }, { status: 400 });
        }
        data.operatorId = operatorId;
      }
    }

    // Handle status update
    if (status) {
      if (!['BOOKED', 'CANCELLED'].includes(status)) {
        return NextResponse.json({ error: 'Invalid status. Use BOOKED or CANCELLED.' }, { status: 400 });
      }
      data.status = status;
      if (status === 'CANCELLED') {
        data.cancelledBy = adminName;
        data.cancellationReason = cancellationReason || `Cancelled by Admin (${adminName})`;
      } else if (status === 'BOOKED') {
        // Restoring a booking - clear cancellation info
        data.cancelledBy = null;
        data.cancellationReason = null;
      }
    }

    // Handle price update
    if (price !== undefined && price !== null) {
      const numPrice = Number(price);
      if (isNaN(numPrice) || numPrice < 0) {
        return NextResponse.json({ error: 'Invalid price value' }, { status: 400 });
      }
      data.price = numPrice;
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const booking = await prisma.booking.update({
      where: { id: bookingId },
      data,
      include: { user: { select: { id: true } } },
    });

    // Process refund when booking is cancelled by admin
    let refundInfo: string | undefined;

    // Structured log context — admin attribution + booking owner so a
    // single email search pulls every admin action against that user.
    const adminCtx = {
      op: 'booking.cancel.admin',
      user: { id: authUser?.id, email: authUser?.email, name: adminName, role: 'ADMIN' },
      targetUser: booking.userId ? { id: booking.userId } : null,
      centerId: booking.centerId,
      bookingId,
      extra: {
        bookingPrice: booking.price ?? null,
        paymentMethod: booking.paymentMethod ?? null,
        category: booking.category ?? null,
      },
    } as const;

    if (status === 'CANCELLED' && booking.userId) {
      log.info(adminCtx, 'Admin cancellation start');

      // Reprice consecutive siblings first. The cancelled booking's
      // `price` is reduced in-place by the helper, so the refund logic
      // below automatically uses the post-adjustment amount.
      try {
        const adjustment = await adjustSiblingPricesForCancellation(booking);
        if (adjustment > 0) {
          log.info(
            { ...adminCtx, extra: { ...adminCtx.extra, consecutiveAdjustment: adjustment, refundablePrice: booking.price } },
            'Sibling reprice applied',
          );
        }
      } catch (adjErr) {
        log.error(adminCtx, 'Consecutive pricing adjustment failed', adjErr);
      }

      // ─── Refund (delegates to shared helper) ─────────────────────
      try {
        const refund = await processCancellationRefund({
          booking,
          initiatedByUserId: authUser!.id,
          initiatedByName: adminName,
        });
        if (refund) {
          if (refund.method === 'WALLET') {
            refundInfo = `Refund: ₹${refund.amount} credited to wallet (Balance: ₹${refund.newBalance ?? 'N/A'})`;
          } else {
            refundInfo = `Refund: ₹${refund.amount} will be credited to bank in 5-7 business days`;
          }
          log.info(
            { ...adminCtx, op: 'payment.refund', amount: refund.amount, extra: { ...adminCtx.extra, refundMethod: refund.method } },
            `Refund processed (${refund.method}, admin cancel)`,
          );
        } else {
          // Helper logs the exact reason it returned null (see
          // `[Refund booking=...]` lines). Surface a neutral message
          // here so the admin sees "we tried, nothing to refund" —
          // and the dev can grep the helper's log for the why.
          refundInfo = 'No refund processed (see server logs for reason)';
          log.warn(
            adminCtx,
            'processCancellationRefund returned null — see [Refund booking=...] log for reason',
          );
        }
      } catch (refundErr) {
        log.error(adminCtx, 'Admin cancellation refund failed', refundErr);
        refundInfo = 'Refund attempt failed — please check server logs and process manually';
      }

      // Restore package session if this was a package booking
      try {
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
      } catch (pkgErr) {
        log.error(adminCtx, 'Failed to restore package session', pkgErr);
      }

      // Send cancellation notification
      try {
        const dateStr = formatIST(new Date(booking.date), 'EEE, dd MMM yyyy');
        const timeStr = formatIST(new Date(booking.startTime), 'hh:mm a');
        const endStr = formatIST(new Date(booking.endTime), 'hh:mm a');
        const machineName = booking.machineId ? (MACHINES[booking.machineId as keyof typeof MACHINES]?.shortName || booking.machineId) : booking.ballType;
        const lines = [
          `${dateStr}`,
          `${timeStr} – ${endStr}`,
          `Machine: ${machineName}`,
          `Cancelled by: ${adminName}`,
        ];
        if (cancellationReason) {
          lines.push(`Reason: ${cancellationReason}`);
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
      } catch (notifErr) {
        log.error(adminCtx, 'Failed to create cancellation notification', notifErr);
      }

      // Notify assigned operator about cancellation
      try {
        if (booking.operatorId) {
          const dateStr = formatIST(new Date(booking.date), 'EEE, dd MMM yyyy');
          const timeStr = formatIST(new Date(booking.startTime), 'hh:mm a');
          const endStr = formatIST(new Date(booking.endTime), 'hh:mm a');
          const machineName = booking.machineId ? (MACHINES[booking.machineId as keyof typeof MACHINES]?.shortName || booking.machineId) : booking.ballType;
          await notifyOperatorBookingCancelled(bookingId, {
            customerName: booking.playerName,
            date: dateStr,
            time: `${timeStr} – ${endStr}`,
            machine: machineName,
            cancelledBy: adminName,
            reason: cancellationReason || undefined,
          });
        }
      } catch (opNotifErr) {
        log.error(adminCtx, 'Failed to notify operator about admin cancellation', opNotifErr);
      }

      log.info({ ...adminCtx, extra: { ...adminCtx.extra, refundInfo: refundInfo ?? null } }, 'Admin cancellation complete');
    }

    return NextResponse.json({ id: booking.id, status: booking.status, price: booking.price });
  } catch (error: any) {
    log.error({ op: 'booking.cancel.admin' }, 'Admin booking update error', error);
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}

// POST: Copy booking to next consecutive slot
export async function POST(req: NextRequest) {
  try {
    const session = await requireCenterAdmin(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { bookingId, action } = await req.json();

    if (!bookingId || !action) {
      return NextResponse.json({ error: 'Booking ID and action are required' }, { status: 400 });
    }

    if (action === 'copy_next_slot') {
      const authUser = await getAuthenticatedUser(req);
      const createdBy = authUser?.name || authUser?.id || 'Admin';

      // Find the source booking
      const sourceBooking = await prisma.booking.findUnique({
        where: { id: bookingId },
      });

      if (!sourceBooking) {
        return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
      }

      // Calculate next slot time (30 min after current endTime)
      const nextStartTime = new Date(sourceBooking.endTime);
      const nextEndTime = new Date(nextStartTime.getTime() + 30 * 60 * 1000);

      // Check if slot is already booked
      const existing = await prisma.booking.findFirst({
        where: {
          date: sourceBooking.date,
          startTime: nextStartTime,
          machineId: sourceBooking.machineId,
          pitchType: sourceBooking.pitchType,
          status: 'BOOKED',
        },
      });

      if (existing) {
        return NextResponse.json({ error: 'Next slot is already booked' }, { status: 409 });
      }

      // Apply consecutive pricing if available
      let newPrice = sourceBooking.price;
      let updatedSourcePrice = sourceBooking.price;
      try {
        const { getPricingConfig, getTimeSlabConfig, calculateNewPricing } = await import('@/lib/pricing');
        const [pricingConfig, timeSlabConfig] = await Promise.all([
          getPricingConfig(),
          getTimeSlabConfig(),
        ]);

        const isMachineA = ['LEATHER', 'MACHINE'].includes(sourceBooking.ballType);
        const category: 'MACHINE' | 'TENNIS' = isMachineA ? 'MACHINE' : 'TENNIS';

        // Calculate consecutive pricing for 2 slots
        const pricing = calculateNewPricing(
          [
            { startTime: sourceBooking.startTime, endTime: sourceBooking.endTime },
            { startTime: nextStartTime, endTime: nextEndTime },
          ],
          category,
          sourceBooking.ballType as any,
          sourceBooking.pitchType as any,
          timeSlabConfig,
          pricingConfig
        );

        if (pricing[1]) {
          newPrice = pricing[1].price;
          updatedSourcePrice = pricing[0].price;
        }
      } catch {
        // fallback: keep same price
      }

      // Auto-assign operator if booking requires one
      let assignedOperatorId: string | null = null;
      if (sourceBooking.operationMode === 'WITH_OPERATOR') {
        assignedOperatorId = await autoAssignOperator(
          sourceBooking.date,
          nextStartTime,
          undefined,
          sourceBooking.machineId
        );
      }

      // Start transaction to create new booking and update source booking price.
      // The new (consecutive) booking inherits the source booking's center.
      const [newBooking] = await prisma.$transaction([
        prisma.booking.create({
          data: {
            centerId: sourceBooking.centerId,
            userId: sourceBooking.userId,
            date: sourceBooking.date,
            startTime: nextStartTime,
            endTime: nextEndTime,
            status: 'BOOKED',
            ballType: sourceBooking.ballType,
            pitchType: sourceBooking.pitchType,
            machineId: sourceBooking.machineId,
            playerName: sourceBooking.playerName,
            operationMode: sourceBooking.operationMode,
            createdBy: createdBy,
            price: newPrice,
            originalPrice: sourceBooking.originalPrice,
            ...(assignedOperatorId ? { operatorId: assignedOperatorId } : {}),
          },
        }),
        prisma.booking.update({
          where: { id: sourceBooking.id },
          data: { price: updatedSourcePrice }
        })
      ]);

      return NextResponse.json(newBooking);
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error: any) {
    console.error('Admin booking action error:', error);
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}
