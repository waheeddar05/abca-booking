import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getOperatorSession } from '@/lib/adminAuth';
import { getISTTodayUTC, dateStringToUTC } from '@/lib/time';

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
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20')));

    // Build booking filter based on role
    const ALL_MACHINES = ['GRAVITY', 'YANTRA', 'LEVERAGE_INDOOR', 'LEVERAGE_OUTDOOR'];
    let machineIds: string[];
    let assignedMachineIds: string[] = [];

    if (session.isAdmin) {
      machineIds = ALL_MACHINES;
      assignedMachineIds = ALL_MACHINES;
    } else {
      const assignments = await prisma.operatorAssignment.findMany({
        where: { userId: session.userId },
        select: { machineId: true },
      });
      assignedMachineIds = assignments.map((a) => a.machineId);
      if (viewAll) {
        machineIds = ALL_MACHINES;
      } else {
        machineIds = assignedMachineIds.length > 0 ? assignedMachineIds : ALL_MACHINES;
      }
    }

    // Base where clause
    const bookingWhere: any = {
      machineId: { in: machineIds as any },
    };

    // Date filtering
    const isAllMode = dateParam === 'all';
    if (isAllMode) {
      // No date filter — show all bookings
    } else if (dateParam && dateParam !== 'today') {
      bookingWhere.date = dateStringToUTC(dateParam);
    } else {
      bookingWhere.date = getISTTodayUTC();
    }

    // Tab-based status filtering
    const now = new Date();
    if (tab === 'upcoming') {
      bookingWhere.status = 'BOOKED';
      bookingWhere.startTime = { gt: now };
    } else if (tab === 'inProgress') {
      bookingWhere.status = 'BOOKED';
      bookingWhere.startTime = { lte: now };
      bookingWhere.endTime = { gt: now };
    } else if (tab === 'completed') {
      bookingWhere.OR = [
        { status: 'DONE' },
        { status: 'BOOKED', endTime: { lte: now } },
      ];
      // Remove top-level status if set
    } else if (tab === 'cancelled') {
      bookingWhere.status = 'CANCELLED';
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
        orderBy: [
          { startTime: 'desc' as const },
        ],
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
