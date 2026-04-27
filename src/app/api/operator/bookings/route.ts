import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getOperatorSession } from '@/lib/adminAuth';
import { getAuthenticatedUser } from '@/lib/auth';
import { resolveCurrentCenter } from '@/lib/centers';
import { getISTTodayUTC, getISTLastMonthRange, dateStringToUTC } from '@/lib/time';

export async function GET(req: NextRequest) {
  try {
    const session = await getOperatorSession(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const dateParam = searchParams.get('date');
    const viewAll = searchParams.get('viewAll') === 'true';
    const tab = searchParams.get('tab'); // 'upcoming' | 'inProgress' | 'completed' | 'cancelled' | null (all)
    const category = searchParams.get('category'); // 'today' | 'upcoming' | 'previous' | 'lastMonth' | null (all)
    const filterStatus = searchParams.get('status'); // 'BOOKED' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED'
    const filterMachineId = searchParams.get('machineId');
    const customer = searchParams.get('customer');
    const filterDate = searchParams.get('filterDate');
    const fromDate = searchParams.get('from');
    const toDate = searchParams.get('to');
    const sortBy = searchParams.get('sortBy') || 'date';
    const sortOrder = searchParams.get('sortOrder') || 'desc';
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20')));

    // Resolve current center. Operators see only bookings at the center
    // they're currently selected at; admins can pass `?allCenters=true`.
    const allCenters = searchParams.get('allCenters') === 'true';
    const authUser = await getAuthenticatedUser(req);
    const center = authUser ? await resolveCurrentCenter(req, authUser) : null;
    let centerId: string | null = null;
    if (!allCenters && center) {
      centerId = center.id;
    } else if (!allCenters && !center) {
      return NextResponse.json({ error: 'No center selected' }, { status: 400 });
    } else if (allCenters && !authUser?.isSuperAdmin) {
      return NextResponse.json({ error: 'allCenters requires super admin' }, { status: 403 });
    }

    // Build booking filter based on role
    const ALL_MACHINES = ['GRAVITY', 'YANTRA', 'LEVERAGE_INDOOR', 'LEVERAGE_OUTDOOR'];
    let machineIds: string[];
    let assignedMachineIds: string[] = [];

    if (session.isAdmin) {
      machineIds = ALL_MACHINES;
      assignedMachineIds = ALL_MACHINES;
    } else {
      const assignments = await prisma.operatorAssignment.findMany({
        // Operator assignments are center-scoped; only consider this
        // operator's assignments at the current center.
        where: {
          userId: session.userId,
          ...(centerId ? { centerId } : {}),
        },
        select: { machineId: true },
      });
      assignedMachineIds = assignments.map((a) => a.machineId);
      if (viewAll) {
        machineIds = ALL_MACHINES;
      } else {
        machineIds = assignedMachineIds.length > 0 ? assignedMachineIds : ALL_MACHINES;
      }
    }

    // Base where clause — scoped to the current center.
    const bookingWhere: any = {
      machineId: { in: machineIds as any },
      ...(centerId ? { centerId } : {}),
    };

    // If a specific machine filter is set, narrow down further (must still be in allowed machines)
    if (filterMachineId && machineIds.includes(filterMachineId)) {
      bookingWhere.machineId = filterMachineId;
    }

    // Category-based date filtering (matches admin)
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
      bookingWhere.date = {
        gte: lastMonthRange.start,
        lte: lastMonthRange.end,
      };
    } else {
      // Legacy date param support
      const isAllMode = dateParam === 'all';
      if (isAllMode) {
        // No date filter — show all bookings
      } else if (dateParam && dateParam !== 'today') {
        bookingWhere.date = dateStringToUTC(dateParam);
      } else if (!category) {
        // Default: no date restriction (show all) when using new filters
      }
    }

    // Single date filter overrides category date
    if (filterDate) {
      bookingWhere.date = dateStringToUTC(filterDate);
    } else if (fromDate && toDate) {
      bookingWhere.date = {
        gte: dateStringToUTC(fromDate),
        lte: dateStringToUTC(toDate),
      };
    }

    // Customer search
    if (customer) {
      bookingWhere.OR = [
        { playerName: { contains: customer, mode: 'insensitive' } },
        { user: { name: { contains: customer, mode: 'insensitive' } } },
        { user: { email: { contains: customer, mode: 'insensitive' } } },
      ];
    }

    // Status filtering (derived statuses like admin)
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
        ...(bookingWhere.AND || []),
        {
          OR: [
            { status: 'DONE' },
            { status: 'BOOKED', endTime: { lte: now } },
          ],
        },
      ];
    } else if (filterStatus === 'CANCELLED') {
      bookingWhere.status = 'CANCELLED';
    } else if (tab === 'upcoming') {
      // Legacy tab support
      bookingWhere.status = 'BOOKED';
      bookingWhere.startTime = { gt: now };
    } else if (tab === 'inProgress') {
      bookingWhere.status = 'BOOKED';
      bookingWhere.startTime = { lte: now };
      bookingWhere.endTime = { gt: now };
    } else if (tab === 'completed') {
      bookingWhere.OR = [
        ...(bookingWhere.OR || []),
        { status: 'DONE' },
        { status: 'BOOKED', endTime: { lte: now } },
      ];
    } else if (tab === 'cancelled') {
      bookingWhere.status = 'CANCELLED';
    }

    // Sort order
    const orderBy: any = [];
    if (sortBy === 'createdAt') {
      orderBy.push({ createdAt: sortOrder });
    } else {
      orderBy.push({ date: sortOrder });
      orderBy.push({ startTime: sortOrder });
    }

    // Fetch bookings with operator and package info
    const [bookings, total] = await Promise.all([
      prisma.booking.findMany({
        where: bookingWhere,
        include: {
          user: { select: { name: true, email: true, mobileNumber: true } },
          operator: { select: { name: true, mobileNumber: true } },
          packageBooking: {
            include: {
              userPackage: {
                include: {
                  package: { select: { name: true } },
                },
              },
            },
          },
        },
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.booking.count({ where: bookingWhere }),
    ]);

    // Map bookings to include all details
    const mappedBookings = bookings.map((b) => ({
      id: b.id,
      date: b.date.toISOString(),
      startTime: b.startTime.toISOString(),
      endTime: b.endTime.toISOString(),
      status: b.status,
      playerName: b.playerName,
      ballType: b.ballType,
      pitchType: b.pitchType,
      machineId: b.machineId,
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
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      machineIds,
      assignedMachineIds,
      currentOperatorId: session.userId,
      viewAll,
    });
  } catch (error: any) {
    console.error('Operator bookings fetch error:', error);
    return NextResponse.json(
      { error: error?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
