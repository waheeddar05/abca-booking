import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
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
  // Resource-based booking fields (Toplay). null on ABCA rows; the
  // admin UI uses these to render the right chips instead of the
  // legacy machine/pitch enums. category disambiguates the booking
  // kind (MACHINE / SIDEARM / COACHING / FULL_COURT / NET /
  // CORPORATE_BATCH); the three assigned* joins resolve human-
  // readable names; resourceAssignments lists the consumed nets.
  category: true,
  assignedMachineId: true,
  assignedMachine: {
    select: {
      id: true,
      name: true,
      machineType: { select: { code: true, name: true } },
    },
  },
  assignedCoachId: true,
  assignedCoach: { select: { id: true, name: true } },
  assignedStaffId: true,
  assignedStaff: { select: { id: true, name: true } },
  resourceAssignments: {
    select: {
      resource: { select: { id: true, name: true, type: true, category: true } },
    },
  },
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
      // `userInvolvement` controls how the userId param is matched:
      //   - 'customer' (default): only bookings where this user is the
      //     paying customer. Preserves prior behavior for any existing
      //     caller.
      //   - 'any':              every booking the user was involved in
      //     in any role — customer, operator, coach (resource-based
      //     COACHING bookings), or sidearm specialist (SIDEARM bookings).
      // Use 'any' on /admin/users so a center admin can audit an
      // operator/coach/sidearm's full schedule from one place.
      const involvement = (searchParams.get('userInvolvement') || 'customer').toLowerCase();
      if (involvement === 'any') {
        const userClauses: Prisma.BookingWhereInput[] = [
          { userId },
          { operatorId: userId },
          { assignedCoachId: userId },
          { assignedStaffId: userId },
        ];
        // Compose with whatever OR / AND was already built up by the
        // customer / status filters above so we don't accidentally drop
        // those constraints.
        if (where.OR) {
          where.AND = [...(where.AND || []), { OR: where.OR }, { OR: userClauses }];
          delete where.OR;
        } else {
          where.AND = [...(where.AND || []), { OR: userClauses }];
        }
      } else {
        where.userId = userId;
      }
    }

    if (machineId) {
      where.machineId = machineId as MachineIdFilter;
    }

    // Optional booking-category filter (Bowling Machine / Sidearm /
    // Cricket Nets / Full Indoor Court / Personal Coaching). Replaces
    // the legacy 'Machine' filter on the admin UI — both still work
    // server-side for back-compat with any old bookmarks. Falls
    // through unchanged when `categoryFilter` isn't supplied.
    const categoryFilter = searchParams.get('categoryFilter');
    if (categoryFilter) {
      const validCategories = new Set(['MACHINE', 'SIDEARM', 'COACHING', 'NET', 'FULL_COURT', 'CORPORATE_BATCH']);
      if (validCategories.has(categoryFilter)) {
        // NULL Booking.category rows are ABCA's legacy MACHINE-only
        // shape — treat them as MACHINE for filtering so admins on
        // ABCA still see their bowling-machine bookings under that
        // chip.
        if (categoryFilter === 'MACHINE') {
          where.OR = [...(where.OR ?? []), { category: 'MACHINE' }, { category: null }];
        } else {
          where.category = categoryFilter;
        }
      }
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
            // Operator + resource-based staff joins. Surfaces the names
            // on every row so the BookingCard renders machine/coach/
            // staff chips, plus lets admins audit an operator/coach's
            // schedule via /admin/users → History.
            operator: { select: { id: true, name: true, mobileNumber: true } },
            assignedMachine: {
              select: {
                id: true,
                name: true,
                shortName: true,
                machineType: { select: { code: true, name: true } },
              },
            },
            assignedCoach: { select: { id: true, name: true, mobileNumber: true } },
            assignedStaff: { select: { id: true, name: true, mobileNumber: true } },
            resourceAssignments: {
              select: {
                resource: { select: { id: true, name: true, type: true, category: true } },
              },
            },
            // Center info so the user booking history (and any admin
            // surface showing a multi-center list) can render name,
            // address, contact, map link.
            center: {
              select: {
                id: true,
                name: true,
                shortName: true,
                addressLine1: true,
                addressLine2: true,
                city: true,
                contactPhone: true,
                contactEmail: true,
                mapUrl: true,
                // Ground staff are the default contact for Cricket Nets
                // (NET) and Full Indoor Court (FULL_COURT) bookings, which
                // have no per-booking operator / coach / sidearm row. Pull
                // the highest-priority active GROUND_STAFF membership so the
                // admin list can surface the assigned ground staff name the
                // same way the user "My Bookings" page does.
                memberships: {
                  where: { role: 'GROUND_STAFF', isActive: true },
                  orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
                  take: 1,
                  select: {
                    user: { select: { id: true, name: true, mobileNumber: true } },
                  },
                },
              },
            },
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
    const { bookingId, status, price, cancellationReason, operatorId, assignedStaffId } = body;

    if (!bookingId) {
      return NextResponse.json({ error: 'Booking ID is required' }, { status: 400 });
    }

    const authUser = await getAuthenticatedUser(req);
    const adminName = authUser?.name || authUser?.id || 'Admin';

    // Resolve the admin's current center up-front — used to validate that
    // reassigned staff actually belong to this center.
    const patchCenter = authUser ? await resolveCurrentCenter(req, authUser) : null;

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

    // Handle sidearm-specialist reassignment. Mirrors the operator flow:
    // null clears the assignment, otherwise the target must hold an active
    // SIDEARM_SPECIALIST membership at the admin's current center.
    if (assignedStaffId !== undefined) {
      if (assignedStaffId === null) {
        data.assignedStaffId = null;
      } else {
        if (!patchCenter) {
          return NextResponse.json({ error: 'No center selected' }, { status: 400 });
        }
        const membership = await prisma.centerMembership.findFirst({
          where: {
            userId: assignedStaffId,
            centerId: patchCenter.id,
            role: 'SIDEARM_SPECIALIST',
            isActive: true,
          },
          select: { id: true },
        });
        if (!membership) {
          return NextResponse.json(
            { error: 'User is not a sidearm specialist at this center' },
            { status: 400 },
          );
        }
        data.assignedStaffId = assignedStaffId;
      }
    }

    // Handle status update. Restore was removed — admins can only cancel a
    // booking here; reactivating a cancelled booking is no longer supported.
    if (status) {
      if (status !== 'CANCELLED') {
        return NextResponse.json({ error: 'Invalid status. Only CANCELLED is supported.' }, { status: 400 });
      }
      data.status = status;
      data.cancelledBy = adminName;
      data.cancellationReason = cancellationReason || `Cancelled by Admin (${adminName})`;
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

      // Copy Next is the ABCA legacy (MACHINE_PITCH) consecutive flow:
      // it only knows how to clone machineId + pitchType + ballType.
      // Resource-based bookings (Toplay) carry assignedMachineId,
      // assignedCoachId, assignedStaffId, and a set of consumed Resources
      // that this flow doesn't replicate — copying would create a row
      // with the right time but no assignments, causing availability
      // gaps and refund chaos. Block here with a clear message; the
      // admin can re-book the next slot through the normal flow.
      if (sourceBooking.category && sourceBooking.category !== 'MACHINE') {
        return NextResponse.json(
          { error: `Copy Next is only available for machine bookings. ${sourceBooking.category} bookings must be created from the slot grid so coach/staff/resources can be reassigned.` },
          { status: 400 },
        );
      }
      if (!sourceBooking.machineId && sourceBooking.assignedMachineId) {
        return NextResponse.json(
          { error: 'Copy Next is not supported for resource-based bookings yet. Use the slot grid to book the next slot.' },
          { status: 400 },
        );
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
          getPricingConfig(sourceBooking.centerId),
          getTimeSlabConfig(sourceBooking.centerId),
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
          sourceBooking.machineId,
          undefined,
          sourceBooking.centerId,
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
