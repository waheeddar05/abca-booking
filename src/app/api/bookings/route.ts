import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';
import { resolveCurrentCenter } from '@/lib/centers';
import { sanitizeApiError } from '@/lib/api-errors';

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
    const allCenters = searchParams.get('allCenters') === 'true';
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const skip = (page - 1) * limit;

    // Filter by current center by default, matching the multi-center "each
    // center is independent" model. Pass `?allCenters=true` to see history
    // across every center the user has booked at.
    const where: any = { userId };
    if (!allCenters) {
      const center = await resolveCurrentCenter(req, user);
      if (center) where.centerId = center.id;
    }
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
            // Resource-based fields surface the machine / coach / staff
            // names. For ABCA (MACHINE_PITCH) bookings these are all
            // null and the card falls back to the legacy machineId
            // label.
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
            // Center context — shown on every booking card so users
            // know which center, where, and how to reach it without
            // having to leave the page.
            center: {
              select: {
                id: true,
                name: true,
                shortName: true,
                addressLine1: true,
                addressLine2: true,
                city: true,
                state: true,
                pincode: true,
                contactPhone: true,
                contactEmail: true,
                mapUrl: true,
                // Ground staff are the default contact for Cricket Nets
                // and Full Indoor Court bookings (categories that don't
                // have a per-booking operator / coach / sidearm row).
                // Pull the highest-priority active GROUND_STAFF
                // membership; BookingCard surfaces them as a 'Call'
                // pill on NET / FULL_COURT rows.
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
      centerId: b.centerId ?? null,
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
      // Resource-based booking details (Toplay et al.). null on ABCA
      // rows; the BookingCard reads these to render the right chips.
      category: b.category ?? null,
      assignedMachineName: b.assignedMachine
        ? (b.assignedMachine.shortName || b.assignedMachine.name)
        : null,
      assignedMachineFullName: b.assignedMachine?.name ?? null,
      assignedCoachName: b.assignedCoach?.name ?? null,
      assignedStaffName: b.assignedStaff?.name ?? null,
      // Center snapshot for the booking card / receipt — name + address
      // + contact + map link. Falls back to null for legacy rows that
      // somehow predate center linking.
      center: b.center
        ? {
            id: b.center.id,
            name: b.center.name,
            shortName: b.center.shortName ?? null,
            addressLine1: b.center.addressLine1 ?? null,
            addressLine2: b.center.addressLine2 ?? null,
            city: b.center.city ?? null,
            state: b.center.state ?? null,
            pincode: b.center.pincode ?? null,
            contactPhone: b.center.contactPhone ?? null,
            contactEmail: b.center.contactEmail ?? null,
            mapUrl: b.center.mapUrl ?? null,
            // Top-priority ground staff at the center, flattened for
            // BookingCard to render as the contact pill on NET /
            // FULL_COURT rows (which don't have a per-booking operator
            // / coach / sidearm). Null when no GROUND_STAFF member is
            // configured at the center yet.
            groundStaff: (() => {
              const gs = (b.center.memberships ?? [])[0]?.user;
              return gs ? {
                id: gs.id,
                name: gs.name ?? null,
                mobileNumber: gs.mobileNumber ?? null,
              } : null;
            })(),
          }
        : null,
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
  } catch (error) {
    const { message, status } = sanitizeApiError(
      error,
      'bookings.list',
      'Could not load bookings. Please try again.',
    );
    return NextResponse.json({ error: message }, { status });
  }
}
