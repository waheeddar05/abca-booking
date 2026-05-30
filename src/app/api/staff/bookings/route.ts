import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';
import { resolveCurrentCenter } from '@/lib/centers';
import { getISTTodayUTC, getISTLastMonthRange, dateStringToUTC } from '@/lib/time';
import type { Prisma } from '@prisma/client';

/**
 * GET /api/staff/bookings
 *
 * Unified bookings list for any "staff" user — operator, coach, or
 * sidearm specialist. Replaces the older /api/operator/bookings,
 * which only knew about OPERATOR and was hardcoded around the legacy
 * MachineId enum.
 *
 * Query params:
 *   role     OPERATOR | COACH | SIDEARM_SPECIALIST  (required)
 *            Determines which axis of the bookings table to filter
 *            on:
 *              - OPERATOR  → bookings on machines this user is
 *                            assigned to (legacy enum + Machine.id)
 *              - COACH     → bookings where assignedCoachId = self
 *              - SIDEARM_… → bookings where assignedStaffId = self
 *   viewAll  When 'true' AND the user is an admin/super-admin, show
 *            every booking at the center regardless of assignment.
 *   center filter, date filters, sort, pagination — same shape as
 *   the legacy /api/operator/bookings endpoint.
 *
 * Auth:
 *   The user must either (a) have the requested role at the current
 *   center via CenterMembership, OR (b) be ADMIN/super-admin.
 *   Otherwise the request is 403'd. Bookings are always center-scoped.
 */

type StaffRole = 'OPERATOR' | 'COACH' | 'SIDEARM_SPECIALIST';

function isValidRole(r: unknown): r is StaffRole {
  return r === 'OPERATOR' || r === 'COACH' || r === 'SIDEARM_SPECIALIST';
}

const ALL_LEGACY_MACHINES = ['GRAVITY', 'YANTRA', 'LEVERAGE_INDOOR', 'LEVERAGE_OUTDOOR'];

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const role = searchParams.get('role');
    if (!isValidRole(role)) {
      return NextResponse.json(
        { error: 'role must be one of OPERATOR, COACH, SIDEARM_SPECIALIST' },
        { status: 400 },
      );
    }

    const dateParam = searchParams.get('date');
    const viewAll = searchParams.get('viewAll') === 'true';
    const tab = searchParams.get('tab');
    const category = searchParams.get('category');
    const filterStatus = searchParams.get('status');
    const filterMachineId = searchParams.get('machineId');
    const customer = searchParams.get('customer');
    const filterDate = searchParams.get('filterDate');
    const fromDate = searchParams.get('from');
    const toDate = searchParams.get('to');
    const sortBy = searchParams.get('sortBy') || 'date';
    const sortOrder = (searchParams.get('sortOrder') === 'asc' ? 'asc' : 'desc') as 'asc' | 'desc';
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20')));

    // Resolve current center.
    const allCenters = searchParams.get('allCenters') === 'true';
    const center = await resolveCurrentCenter(req, user);
    let centerId: string | null = null;
    if (!allCenters && center) {
      centerId = center.id;
    } else if (!allCenters && !center) {
      return NextResponse.json({ error: 'No center selected' }, { status: 400 });
    } else if (allCenters && !user.isSuperAdmin) {
      return NextResponse.json({ error: 'allCenters requires super admin' }, { status: 403 });
    }

    // Authorization: admins (super or center) bypass; otherwise require
    // a matching CenterMembership at this center.
    const isAdmin =
      user.isSuperAdmin ||
      (user.role === 'ADMIN') ||
      (centerId
        ? user.centerMemberships.some((m) => m.centerId === centerId && m.role === 'ADMIN')
        : false);

    const hasRequestedRole = centerId
      ? user.centerMemberships.some(
          (m) => m.centerId === centerId && m.role === role,
        )
      : user.centerMemberships.some((m) => m.role === role);

    if (!isAdmin && !hasRequestedRole) {
      return NextResponse.json(
        { error: `You're not registered as ${role.toLowerCase().replace('_', ' ')} at this center` },
        { status: 403 },
      );
    }

    // Build the role-specific filter on the booking row. We start
    // with the center scope, then add a role-axis predicate.
    const bookingWhere: Prisma.BookingWhereInput = {
      ...(centerId ? { centerId } : {}),
    };

    // Track what "assigned" means for this role so the response can
    // report it for the UI ("My machines", "Coaching sessions", etc.).
    let assignedMachineEnumIds: string[] = [];
    let assignedMachineRowIds: string[] = [];

    if (role === 'OPERATOR') {
      if (isAdmin && viewAll) {
        // Admin viewAll mode — no machine filter.
        assignedMachineEnumIds = ALL_LEGACY_MACHINES;
      } else {
        // Pull both axes of operator assignments — RESOURCE_BASED
        // assignments use machineRowId, MACHINE_PITCH use machineId.
        const assignments = await prisma.operatorAssignment.findMany({
          where: {
            userId: user.id,
            ...(centerId ? { centerId } : {}),
          },
          select: { machineId: true, machineRowId: true },
        });
        for (const a of assignments) {
          if (a.machineId) assignedMachineEnumIds.push(a.machineId);
          if (a.machineRowId) assignedMachineRowIds.push(a.machineRowId);
        }

        // Build the role predicate. We OR the two machine axes — a
        // single user can be assigned across both (super-admin
        // managing ABCA + Toplay).
        const orClauses: Prisma.BookingWhereInput[] = [];
        if (assignedMachineEnumIds.length > 0) {
          orClauses.push({
            machineId: {
              in: assignedMachineEnumIds as Prisma.BookingWhereInput['machineId'],
            } as never,
          });
        }
        if (assignedMachineRowIds.length > 0) {
          orClauses.push({ assignedMachineId: { in: assignedMachineRowIds } });
        }

        if (orClauses.length === 0) {
          // No assignments at all — admin sees everything (via
          // isAdmin path above), but a vanilla operator with zero
          // rows sees nothing rather than every booking.
          if (isAdmin) {
            assignedMachineEnumIds = ALL_LEGACY_MACHINES;
          } else {
            return NextResponse.json({
              bookings: [],
              pagination: { page, limit, total: 0, totalPages: 0 },
              role,
              assignedMachineIds: assignedMachineEnumIds,
              assignedMachineRowIds,
              currentUserId: user.id,
              viewAll,
            });
          }
        } else {
          bookingWhere.OR = orClauses;
        }
      }

      // Specific-machine filter from the UI dropdown. Honour both
      // axes — UI sends either an enum string or a Machine.id. We
      // detect by looking at the format (legacy enums are uppercase
      // identifiers; Machine.id is a cuid).
      if (filterMachineId) {
        if (ALL_LEGACY_MACHINES.includes(filterMachineId)) {
          bookingWhere.machineId = filterMachineId as never;
          delete bookingWhere.OR;
        } else {
          bookingWhere.assignedMachineId = filterMachineId;
          delete bookingWhere.OR;
        }
      }
    } else if (role === 'COACH') {
      // A coach's own bookings = COACHING category bookings where the
      // coach assignment matches this user. Admin viewAll widens to
      // all COACHING category bookings at the center.
      if (isAdmin && viewAll) {
        bookingWhere.category = 'COACHING';
      } else {
        bookingWhere.assignedCoachId = user.id;
      }
    } else if (role === 'SIDEARM_SPECIALIST') {
      if (isAdmin && viewAll) {
        bookingWhere.category = 'SIDEARM';
      } else {
        bookingWhere.assignedStaffId = user.id;
      }
    }

    // Date / category filters — shared with legacy operator endpoint.
    const todayUTC = getISTTodayUTC();
    if (category === 'today') {
      bookingWhere.date = todayUTC;
    } else if (category === 'upcoming') {
      bookingWhere.date = { gt: todayUTC };
      bookingWhere.status = 'BOOKED';
    } else if (category === 'previous') {
      bookingWhere.date = { lt: todayUTC };
    } else if (category === 'lastMonth') {
      const lastMonthRange = getISTLastMonthRange();
      bookingWhere.date = { gte: lastMonthRange.start, lte: lastMonthRange.end };
    } else if (dateParam && dateParam !== 'all' && dateParam !== 'today') {
      bookingWhere.date = dateStringToUTC(dateParam);
    }

    if (filterDate) {
      bookingWhere.date = dateStringToUTC(filterDate);
    } else if (fromDate && toDate) {
      bookingWhere.date = {
        gte: dateStringToUTC(fromDate),
        lte: dateStringToUTC(toDate),
      };
    }

    if (customer) {
      const customerOr: Prisma.BookingWhereInput[] = [
        { playerName: { contains: customer, mode: 'insensitive' } },
        { user: { name: { contains: customer, mode: 'insensitive' } } },
        { user: { email: { contains: customer, mode: 'insensitive' } } },
      ];
      // Stack the role's existing OR with the customer search via AND.
      if (bookingWhere.OR) {
        bookingWhere.AND = [
          ...((bookingWhere.AND as Prisma.BookingWhereInput[]) || []),
          { OR: bookingWhere.OR },
          { OR: customerOr },
        ];
        delete bookingWhere.OR;
      } else {
        bookingWhere.OR = customerOr;
      }
    }

    // Status filtering — derived statuses (IN_PROGRESS / DONE) match
    // the admin booking list semantics.
    const now = new Date();
    if (filterStatus === 'IN_PROGRESS') {
      bookingWhere.status = 'BOOKED';
      bookingWhere.startTime = { lte: now };
      bookingWhere.endTime = { gt: now };
    } else if (filterStatus === 'BOOKED') {
      bookingWhere.status = 'BOOKED';
      bookingWhere.startTime = { gt: now };
    } else if (filterStatus === 'DONE') {
      bookingWhere.AND = [
        ...((bookingWhere.AND as Prisma.BookingWhereInput[]) || []),
        {
          OR: [{ status: 'DONE' }, { status: 'BOOKED', endTime: { lte: now } }],
        },
      ];
    } else if (filterStatus === 'CANCELLED') {
      bookingWhere.status = 'CANCELLED';
    } else if (tab === 'upcoming') {
      bookingWhere.status = 'BOOKED';
      bookingWhere.startTime = { gt: now };
    } else if (tab === 'inProgress') {
      bookingWhere.status = 'BOOKED';
      bookingWhere.startTime = { lte: now };
      bookingWhere.endTime = { gt: now };
    } else if (tab === 'completed') {
      bookingWhere.AND = [
        ...((bookingWhere.AND as Prisma.BookingWhereInput[]) || []),
        {
          OR: [{ status: 'DONE' }, { status: 'BOOKED', endTime: { lte: now } }],
        },
      ];
    } else if (tab === 'cancelled') {
      bookingWhere.status = 'CANCELLED';
    }

    const orderBy: Prisma.BookingOrderByWithRelationInput[] =
      sortBy === 'createdAt'
        ? [{ createdAt: sortOrder }]
        : [{ date: sortOrder }, { startTime: sortOrder }];

    const [bookings, total] = await Promise.all([
      prisma.booking.findMany({
        where: bookingWhere,
        include: {
          user: { select: { name: true, email: true, mobileNumber: true } },
          operator: { select: { name: true, mobileNumber: true } },
          assignedMachine: {
            select: { id: true, name: true, shortName: true, machineType: { select: { code: true, name: true } } },
          },
          assignedCoach: { select: { id: true, name: true } },
          assignedStaff: { select: { id: true, name: true } },
          packageBooking: {
            include: {
              userPackage: { include: { package: { select: { name: true } } } },
            },
          },
        },
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.booking.count({ where: bookingWhere }),
    ]);

    const mappedBookings = bookings.map((b) => ({
      id: b.id,
      date: b.date.toISOString(),
      startTime: b.startTime.toISOString(),
      endTime: b.endTime.toISOString(),
      status: b.status,
      category: b.category,
      playerName: b.playerName,
      ballType: b.ballType,
      pitchType: b.pitchType,
      machineId: b.machineId,
      assignedMachineId: b.assignedMachineId,
      assignedMachineName: b.assignedMachine
        ? b.assignedMachine.shortName ?? b.assignedMachine.name
        : null,
      assignedCoachName: b.assignedCoach?.name ?? null,
      assignedStaffName: b.assignedStaff?.name ?? null,
      price: b.price,
      originalPrice: b.originalPrice,
      discountAmount: b.discountAmount,
      extraCharge: b.extraCharge,
      operationMode: b.operationMode,
      kitRental: b.kitRental ?? false,
      kitRentalCharge: b.kitRentalCharge ?? null,
      cancelledBy: b.cancelledBy,
      createdAt: b.createdAt ? b.createdAt.toISOString() : null,
      paymentMethod: b.paymentMethod ?? null,
      paymentStatus: b.paymentStatus ?? null,
      isPackageBooking: !!b.packageBooking,
      packageName: b.packageBooking?.userPackage?.package?.name || null,
      operatorName: b.operator?.name || null,
      operatorMobile: b.operator?.mobileNumber || null,
      customerName: b.user?.name || b.playerName,
      customerEmail: b.user?.email || null,
      customerMobile: b.user?.mobileNumber || null,
    }));

    return NextResponse.json({
      bookings: mappedBookings,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      role,
      assignedMachineIds: assignedMachineEnumIds,
      assignedMachineRowIds,
      currentUserId: user.id,
      viewAll,
    });
  } catch (error: any) {
    console.error('Staff bookings fetch error:', error);
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}
