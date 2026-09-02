import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireCenterAdmin } from '@/lib/adminAuth';
import { getAuthenticatedUser } from '@/lib/auth';
import { resolveCurrentCenter } from '@/lib/centers';
import { getISTTodayUTC, getISTLastMonthRange, dateStringToUTC, formatIST } from '@/lib/time';
import { notifyBookingCancelled, notifyAssignedStaffBookingCancelled, buildCancellationDetailLines } from '@/lib/notifications';
import {
  adjustSiblingPricesForCancellation,
  processCancellationRefund,
} from '@/lib/booking-cancellation';
import { getBookingPaymentSplits, splitAmountNet, EMPTY_SPLIT } from '@/lib/booking-payment';
import { canOperateAtCenter } from '@/lib/operatorAssign';
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
  // Join the operator the same way assignedCoach / assignedStaff /
  // assignedGroundStaff are joined below. Without it this fallback
  // select carried a bare id and every consumer rendered the booking as
  // having no operator.
  operator: { select: { id: true, name: true, mobileNumber: true } },
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
  // Match Practice (Corporate Batch) enrollment context — drives the
  // "Enrollment: Monthly · July 2026" row in BookingDetailsList.
  corporateBatchMode: true,
  enrollmentPeriod: true,
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
  assignedGroundStaffId: true,
  assignedGroundStaff: { select: { id: true, name: true, mobileNumber: true } },
  resourceAssignments: {
    select: {
      resource: { select: { id: true, name: true, type: true, category: true } },
    },
  },
  // Package-redemption fields. Carried on the fallback select too so the
  // admin Bookings list can value package sessions (per-session revenue =
  // amountPaid / totalSessions × sessionsUsed + extraCharge) even when the
  // primary query had to fall back.
  packageBooking: {
    select: {
      sessionsUsed: true,
      extraCharge: true,
      userPackage: {
        select: {
          amountPaid: true,
          totalSessions: true,
          package: { select: { name: true } },
        },
      },
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
    const now = new Date();

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
        // customer filter above so we don't accidentally drop it.
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
    // Cricket Nets / Full Indoor Court / Personal Coaching). Every
    // Booking row carries a non-null `category` (schema default
    // 'MACHINE'; the resource-bookings migration backfilled ABCA's
    // legacy rows to MACHINE), so an exact equality match is correct
    // for every category — including MACHINE.
    //
    // BUGFIX: the MACHINE branch previously used
    //   OR: [{ category: 'MACHINE' }, { category: null }]
    // On a non-nullable enum a `null` filter is not a valid IS NULL
    // predicate, so Prisma collapsed that OR into a match-everything
    // clause — which is exactly why selecting "Bowling Machine"
    // returned Cricket Nets (and every other) booking. Filtering by
    // exact equality, the same way the other categories already do,
    // fixes the leak.
    const categoryFilter = searchParams.get('categoryFilter');
    if (categoryFilter) {
      const validCategories = new Set(['MACHINE', 'SIDEARM', 'COACHING', 'NET', 'FULL_COURT', 'CORPORATE_BATCH', 'MATCH_SIMULATION']);
      if (validCategories.has(categoryFilter)) {
        where.category = categoryFilter;
      }
    }

    // Snapshot the where for the summary counts AFTER every non-status
    // filter (center, date, customer, machine, category) so the
    // booked / done / cancelled breakdown reflects exactly what the
    // admin filtered to. Cloned BEFORE the explicit status filter
    // because the summary derives its own per-status counts below.
    const summaryBaseWhere = JSON.parse(JSON.stringify(where));

    // Status filter: IN_PROGRESS, DONE, BOOKED(Upcoming) are derived
    // statuses not stored in DB — computed from BOOKED + current time
    // via getDisplayStatus().
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
    } else if (status === 'ACTIVE') {
      // Everything except cancelled. The dashboard's Booking Distribution
      // "Today" counts exclude cancelled rows, so its click-through links
      // pass this to make the list reconcile with the count exactly.
      where.status = { not: 'CANCELLED' };
    } else if (status) {
      where.status = status;
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
            assignedCoach: { select: { id: true, name: true } },
            assignedStaff: { select: { id: true, name: true } },
            assignedGroundStaff: { select: { id: true, name: true, mobileNumber: true } },
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
                // Ground staff are the default on-site contact for Cricket
                // Nets (NET) and Full Indoor Court (FULL_COURT) bookings,
                // which have no per-booking operator / coach / sidearm row.
                // Pull the highest-priority active GROUND_STAFF membership so
                // the admin Bookings view can surface the name the same way
                // the user My Bookings page does.
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
                // sessionsUsed + extraCharge + the parent package's
                // amountPaid/totalSessions let the UI value each redeemed
                // package session, so the Bookings list shows package
                // revenue instead of a bare "Package Session" with no amount.
                sessionsUsed: true,
                extraCharge: true,
                userPackage: {
                  select: {
                    amountPaid: true,
                    totalSessions: true,
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

    // Attach the funds actually collected (online + wallet) per row, net of
    // refunds, so the admin list shows "amount paid by the user" instead of the
    // list price. Derived from the captured Payment record (even per-slot share
    // of the order); cash/free/package-covered rows resolve to 0. Same
    // definition the dashboard + CSV export use, so the three surfaces
    // reconcile.
    const paymentSplits = await getBookingPaymentSplits(
      bookings.map((b) => ({ id: b.id, price: b.price, paymentMethod: b.paymentMethod })),
    );
    for (const b of bookings) {
      b.amountPaid = splitAmountNet(paymentSplits.get(b.id) ?? EMPTY_SPLIT, b.refunds ?? []);
    }

    // Summary counts use baseWhere (without status time constraints) + derived status logic
    const [bookedCount, doneCount, cancelledCount, revenueValue] = await Promise.all([
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
      // Amount collected for the filtered view — the sum of what customers
      // actually paid across the active (BOOKED + DONE) bookings in scope:
      // (online + wallet) − non-failed refunds. Cash/free bookings collect
      // nothing through these rails and add 0. This matches the dashboard's
      // Booking Revenue definition and the CSV export's money columns, so the
      // pill, the per-row amounts, and the dashboard all reconcile.
      (async () => {
        try {
          const revenueBookings = await prisma.booking.findMany({
            where: {
              AND: [
                summaryBaseWhere,
                { status: { in: ['BOOKED', 'DONE'] } },
              ],
            },
            select: {
              id: true,
              price: true,
              paymentMethod: true,
              refunds: { select: { amount: true, status: true } },
            },
          });
          const revenueSplits = await getBookingPaymentSplits(revenueBookings);
          let revenue = 0;
          for (const b of revenueBookings) {
            revenue += splitAmountNet(revenueSplits.get(b.id) ?? EMPTY_SPLIT, b.refunds);
          }
          return Math.round(revenue);
        } catch {
          return 0;
        }
      })(),
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
        // Net revenue across the filtered set (regular + package sessions).
        revenue: revenueValue,
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
    const { bookingId, status, cancellationReason, operatorId, assignedStaffId, assignedGroundStaffId } = body;

    if (!bookingId) {
      return NextResponse.json({ error: 'Booking ID is required' }, { status: 400 });
    }

    // Moderators are restricted admins: they may NOT cancel bookings or
    // change staff assignments (operator / sidearm specialist / coach /
    // ground staff). Everything else on this endpoint stays allowed.
    if (session.isModerator) {
      const isCancelling = status === 'CANCELLED';
      const isReassigning =
        operatorId !== undefined ||
        assignedStaffId !== undefined ||
        assignedGroundStaffId !== undefined;
      if (isCancelling || isReassigning) {
        return NextResponse.json(
          { error: 'Moderators cannot cancel bookings or change staff assignments.' },
          { status: 403 },
        );
      }
    }

    const authUser = await getAuthenticatedUser(req);
    const adminName = authUser?.name || authUser?.id || 'Admin';

    const data: any = {};

    // Handle operator reassignment.
    //
    // The dropdown that feeds this endpoint is built from
    // CenterMembership (GET /api/admin/operators), so validating against
    // the global `User.role` column rejected every operator who was
    // granted the role through the center Members tab — the admin picked
    // a name the UI had just offered them and got "User is not an
    // operator". Validate the same way the sidearm / ground-staff
    // branches below do: an active membership at THIS booking's center.
    if (operatorId !== undefined) {
      if (operatorId === null) {
        // Unassign operator. A machine booking with no operator is, by
        // definition, self-operated — leaving operationMode at
        // WITH_OPERATOR is what produced rows that render as a dangling
        // "Unassigned" operator forever.
        data.operatorId = null;
        data.operationMode = 'SELF_OPERATE';
      } else {
        const target = await prisma.booking.findUnique({
          where: { id: bookingId },
          select: { centerId: true },
        });
        if (!target) {
          return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
        }
        const operator = await prisma.user.findUnique({
          where: { id: operatorId },
          select: { id: true },
        });
        if (!operator) {
          return NextResponse.json({ error: 'Operator not found' }, { status: 404 });
        }
        if (!(await canOperateAtCenter(operatorId, target.centerId))) {
          return NextResponse.json(
            { error: 'User is not an operator at this center' },
            { status: 400 },
          );
        }
        data.operatorId = operatorId;
        // Naming an operator implies the session is operator-run. Without
        // this the admin's assignment lands on a SELF_OPERATE row and the
        // operator control disappears from the UI on the next refresh.
        data.operationMode = 'WITH_OPERATOR';
      }
    }

    // Handle sidearm specialist reassignment. Mirrors the operator flow
    // above: null unassigns, otherwise the target must hold an active
    // SIDEARM_SPECIALIST membership at THIS booking's center (the role
    // lives on CenterMembership, not User.role, so we validate against
    // the booking's center to keep cross-center reassignment honest).
    if (assignedStaffId !== undefined) {
      if (assignedStaffId === null) {
        data.assignedStaffId = null;
      } else {
        const target = await prisma.booking.findUnique({
          where: { id: bookingId },
          select: { centerId: true },
        });
        if (!target) {
          return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
        }
        const membership = await prisma.centerMembership.findFirst({
          where: {
            userId: assignedStaffId,
            centerId: target.centerId,
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

    // Handle ground-staff reassignment. Same shape as the sidearm flow:
    // null unassigns, otherwise the target must hold an active GROUND_STAFF
    // membership at THIS booking's center.
    if (assignedGroundStaffId !== undefined) {
      if (assignedGroundStaffId === null) {
        data.assignedGroundStaffId = null;
      } else {
        const target = await prisma.booking.findUnique({
          where: { id: bookingId },
          select: { centerId: true },
        });
        if (!target) {
          return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
        }
        const membership = await prisma.centerMembership.findFirst({
          where: {
            userId: assignedGroundStaffId,
            centerId: target.centerId,
            role: 'GROUND_STAFF',
            isActive: true,
          },
          select: { id: true },
        });
        if (!membership) {
          return NextResponse.json(
            { error: 'User is not ground staff at this center' },
            { status: 400 },
          );
        }
        data.assignedGroundStaffId = assignedGroundStaffId;
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

    // Booking amounts are read-only from the admin Bookings section — the
    // price is set at booking creation and is intentionally not editable here.

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
        // Category-aware detail line(s): machine for MACHINE bookings,
        // specialist/coach for SIDEARM/COACHING, type-only for the rest.
        // Never leaks the TENNIS ballType default as a fake "Machine".
        const detailLines = await buildCancellationDetailLines(bookingId);
        const lines = [
          `${dateStr}`,
          `${timeStr} – ${endStr}`,
          ...detailLines,
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
          centerId: booking.centerId,
          bookingId,
        });
      } catch (notifErr) {
        log.error(adminCtx, 'Failed to create cancellation notification', notifErr);
      }

      // Notify every assigned staff member (operator / coach / specialist)
      try {
        await notifyAssignedStaffBookingCancelled(bookingId, {
          cancelledBy: adminName,
          reason: cancellationReason || undefined,
          actorUserId: authUser?.id ?? null,
        });
      } catch (opNotifErr) {
        log.error(adminCtx, 'Failed to notify staff about admin cancellation', opNotifErr);
      }

      log.info({ ...adminCtx, extra: { ...adminCtx.extra, refundInfo: refundInfo ?? null } }, 'Admin cancellation complete');
    }

    return NextResponse.json({ id: booking.id, status: booking.status, price: booking.price });
  } catch (error: any) {
    log.error({ op: 'booking.cancel.admin' }, 'Admin booking update error', error);
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}
