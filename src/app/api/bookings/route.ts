import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';

// Safe select: only columns guaranteed to exist (pre-migration)
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
} as const;

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = user.id;
    const { searchParams } = new URL(req.url);
    const tab = searchParams.get('tab'); // all, upcoming, inProgress, completed, cancelled
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const skip = (page - 1) * limit;

    const where: any = { userId };
    const now = new Date();

    if (tab === 'upcoming') {
      where.status = 'BOOKED';
      where.startTime = { gt: now };
    } else if (tab === 'inProgress') {
      where.status = 'BOOKED';
      where.startTime = { lte: now };
      where.endTime = { gt: now };
    } else if (tab === 'completed') {
      where.OR = [
        { status: 'DONE' },
        { status: 'BOOKED', endTime: { lte: now } },
      ];
    } else if (tab === 'cancelled') {
      where.status = 'CANCELLED';
    }

    // Try full query first; if new columns don't exist, fall back to safe select
    let bookings: any[];
    let total: number;
    try {
      [bookings, total] = await Promise.all([
        prisma.booking.findMany({
          where,
          orderBy: { startTime: 'desc' },
          skip,
          take: limit,
          include: {
            operator: {
              select: { name: true, mobileNumber: true },
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
          },
        }),
        prisma.booking.count({ where }),
      ]);
    } catch {
      [bookings, total] = await Promise.all([
        prisma.booking.findMany({
          where,
          orderBy: { startTime: 'desc' },
          select: SAFE_BOOKING_SELECT,
          skip,
          take: limit,
        }),
        prisma.booking.count({ where }),
      ]);
    }

    // Check if any booking has a package booking
    const bookingIds = bookings.map((b: any) => b.id);
    let packageBookings: any[] = [];
    try {
      packageBookings = await prisma.packageBooking.findMany({
        where: { bookingId: { in: bookingIds } },
        select: { bookingId: true },
      });
    } catch {
      // ignore if table doesn't exist
    }
    const packageBookingSet = new Set(packageBookings.map((pb: any) => pb.bookingId));

    // Fetch refund info for all bookings from the Refund table
    let refundMap: Record<string, { method: string; totalRefunded: number; refunds: Array<{ method: string; amount: number; status: string; refundedAt: string }> }> = {};
    if (bookingIds.length > 0) {
      try {
        const refunds = await prisma.refund.findMany({
          where: {
            bookingId: { in: bookingIds },
            status: { not: 'FAILED' },
          },
          select: {
            bookingId: true,
            amount: true,
            method: true,
            status: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        });
        for (const r of refunds) {
          if (!refundMap[r.bookingId]) {
            refundMap[r.bookingId] = { method: r.method, totalRefunded: 0, refunds: [] };
          }
          refundMap[r.bookingId].totalRefunded += r.amount;
          refundMap[r.bookingId].refunds.push({
            method: r.method,
            amount: r.amount,
            status: r.status,
            refundedAt: r.createdAt.toISOString(),
          });
        }
      } catch {
        // ignore if table doesn't exist yet
      }
    }

    const mappedBookings = bookings.map((b: any) => ({
      id: b.id,
      date: b.date.toISOString(),
      startTime: b.startTime.toISOString(),
      endTime: b.endTime.toISOString(),
      ballType: b.ballType,
      playerName: b.playerName,
      status: b.status,
      price: b.price ?? null,
      originalPrice: b.originalPrice ?? null,
      discountAmount: b.discountAmount ?? null,
      discountType: b.discountType ?? null,
      pitchType: b.pitchType ?? null,
      extraCharge: b.extraCharge ?? null,
      operationMode: b.operationMode ?? 'WITH_OPERATOR',
      machineId: b.machineId ?? null,
      createdBy: b.createdBy ?? null,
      cancelledBy: b.cancelledBy ?? null,
      cancellationReason: b.cancellationReason ?? null,
      paymentMethod: b.paymentMethod ?? null,
      paymentStatus: b.paymentStatus ?? null,
      refund: refundMap[b.id] ? {
        method: refundMap[b.id].method,
        amount: refundMap[b.id].totalRefunded,
        refundedAt: refundMap[b.id].refunds[0]?.refundedAt || null,
        refunds: refundMap[b.id].refunds,
      } : null,
      kitRental: b.kitRental ?? false,
      kitRentalCharge: b.kitRentalCharge ?? null,
      createdAt: b.createdAt ? b.createdAt.toISOString() : null,
      isPackageBooking: packageBookingSet.has(b.id),
      packageName: b.packageBooking?.userPackage?.package?.name || null,
      operatorName: b.operator?.name || null,
      operatorMobile: b.operator?.mobileNumber || null,
    }));

    return NextResponse.json({
      bookings: mappedBookings,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error: any) {
    console.error('Fetch bookings error:', error);
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}
