import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';
import { dateStringToUTC, formatIST } from '@/lib/time';
import { isValidMachineId, LEATHER_MACHINES, MACHINES } from '@/lib/constants';
import { notifyBookingCancelled } from '@/lib/notifications';
import { resolveCurrentCenter } from '@/lib/centers';
import type { MachineId } from '@prisma/client';

// GET /api/admin/slots/block - List blocked slots at the admin's current center
export async function GET(req: NextRequest) {
  try {
    const admin = await getAuthenticatedUser(req);
    if (!admin || admin.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const includeExpired = searchParams.get('includeExpired') === 'true';
    const allCenters = searchParams.get('allCenters') === 'true';

    const center = await resolveCurrentCenter(req, admin);
    const where: any = {};
    if (!allCenters && center) {
      where.centerId = center.id;
    } else if (!allCenters && !center) {
      return NextResponse.json({ error: 'No center selected' }, { status: 400 });
    } else if (allCenters && !admin.isSuperAdmin) {
      return NextResponse.json({ error: 'allCenters requires super admin' }, { status: 403 });
    }

    if (!includeExpired) {
      // Only show blocks whose endDate is today or in the future
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      where.endDate = { gte: today };
    }

    const blockedSlots = await prisma.blockedSlot.findMany({
      where,
      orderBy: { startDate: 'desc' },
    });

    return NextResponse.json(blockedSlots);
  } catch (error) {
    console.error('Get blocked slots error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/admin/slots/block - Block slots
export async function POST(req: NextRequest) {
  try {
    const admin = await getAuthenticatedUser(req);

    if (!admin || admin.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const {
      startDate,
      endDate,
      startTime, // "HH:mm" or null
      endTime,   // "HH:mm" or null
      machineType,  // Legacy: BallType ('LEATHER' | 'TENNIS')
      machineId,    // New: specific machine ID (single)
      machineIds,   // New: multiple machine IDs array
      recurringDays, // New: array of day-of-week numbers (0=Sun, 1=Mon, ..., 6=Sat)
      pitchType,
      reason,
      appliesTo,
    } = body;

    if (!startDate || !endDate) {
      return NextResponse.json({ error: 'Start date and end date are required' }, { status: 400 });
    }

    const start = dateStringToUTC(startDate);
    const end = dateStringToUTC(endDate);

    let startT: Date | null = null;
    let endT: Date | null = null;

    if (startTime && endTime) {
      startT = new Date(`1970-01-01T${startTime}:00+05:30`);
      endT = new Date(`1970-01-01T${endTime}:00+05:30`);
    }

    // Validate machineId(s)
    let validatedMachineId: MachineId | null = null;
    const validatedMachineIds: string[] = [];

    if (machineIds && Array.isArray(machineIds) && machineIds.length > 0) {
      // Multiple machines - store in machineIds array
      for (const mid of machineIds) {
        if (isValidMachineId(mid)) {
          validatedMachineIds.push(mid);
        }
      }
    } else if (machineId && isValidMachineId(machineId)) {
      validatedMachineId = machineId as MachineId;
    }

    // Validate recurringDays
    const validatedRecurringDays: number[] = [];
    if (recurringDays && Array.isArray(recurringDays)) {
      for (const d of recurringDays) {
        if (typeof d === 'number' && d >= 0 && d <= 6) {
          validatedRecurringDays.push(d);
        }
      }
    }

    // BlockedSlot is center-scoped — bind to admin's current center.
    const center = await resolveCurrentCenter(req, admin);
    if (!center) {
      return NextResponse.json({ error: 'No center selected' }, { status: 400 });
    }

    // 1. Create a single BlockedSlot record
    const blockedSlot = await prisma.blockedSlot.create({
      data: {
        centerId: center.id,
        startDate: start,
        endDate: end,
        startTime: startT,
        endTime: endT,
        machineType: (validatedMachineId || validatedMachineIds.length > 0) ? null : machineType,
        machineId: validatedMachineId,
        machineIds: validatedMachineIds,
        recurringDays: validatedRecurringDays,
        pitchType,
        reason,
        blockedBy: admin.id,
        appliesTo: ['ALL', 'SPECIAL', 'NON_SPECIAL'].includes(appliesTo) ? appliesTo : 'ALL',
      },
    });

    // 2. Find and cancel conflicting bookings
    const where: any = {
      date: {
        gte: start,
        lte: end,
      },
      status: 'BOOKED',
    };

    if (validatedMachineIds.length > 0) {
      // Multiple specific machines
      where.machineId = { in: validatedMachineIds };
    } else if (validatedMachineId) {
      where.machineId = validatedMachineId;
    } else if (machineType) {
      if (machineType === 'LEATHER' || machineType === 'MACHINE') {
        where.OR = [
          { ballType: { in: ['LEATHER', 'MACHINE'] } },
          { machineId: { in: LEATHER_MACHINES } },
        ];
      } else {
        where.ballType = 'TENNIS';
      }
    }

    if (pitchType) {
      where.pitchType = pitchType;
    }

    const conflictingBookings = await prisma.booking.findMany({
      where,
    });

    const bookingsToCancel = conflictingBookings.filter(booking => {
      // For recurring blocks, check if the booking date falls on a recurring day
      if (validatedRecurringDays.length > 0) {
        const bookingDate = new Date(booking.date);
        const dayOfWeek = bookingDate.getUTCDay();
        if (!validatedRecurringDays.includes(dayOfWeek)) return false;
      }

      // If full day block (startTime is null), all matching are conflicting
      if (!startT || !endT) return true;

      const getMinutes = (d: Date) => d.getUTCHours() * 60 + d.getUTCMinutes();

      const blockStartMin = getMinutes(startT);
      const blockEndMin = getMinutes(endT);

      const bookingStartMin = getMinutes(new Date(booking.startTime));
      const bookingEndMin = getMinutes(new Date(booking.endTime));

      return bookingStartMin < blockEndMin && bookingEndMin > blockStartMin;
    });

    if (bookingsToCancel.length > 0) {
      const displayReason = `Cancelled by Admin - ${reason || 'Maintenance'}`;
      const cancelledByName = `Admin (${admin.name || admin.id})`;

      // Cancel bookings in a transaction
      await prisma.$transaction(
        bookingsToCancel.map(booking =>
          prisma.booking.update({
            where: { id: booking.id },
            data: {
              status: 'CANCELLED',
              cancelledBy: cancelledByName,
              cancellationReason: displayReason,
            }
          })
        )
      );

      // Send notifications (outside transaction — non-blocking)
      const notifBookings = bookingsToCancel.filter(b => b.userId);
      if (notifBookings.length > 0) {
        // Fetch mobile numbers for all affected users
        const userIds = [...new Set(notifBookings.map(b => b.userId as string))];
        const users = await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, mobileNumber: true, mobileVerified: true },
        });
        const userMap = new Map(users.map(u => [u.id, u]));

        await Promise.allSettled(
          notifBookings.map(booking => {
            const dateStr = formatIST(new Date(booking.date), 'EEE, dd MMM yyyy');
            const timeStr = formatIST(new Date(booking.startTime), 'hh:mm a');
            const endStr = formatIST(new Date(booking.endTime), 'hh:mm a');
            const machineName = booking.machineId ? (MACHINES[booking.machineId]?.shortName || booking.machineId) : booking.ballType;
            const lines = [
              `${dateStr}`,
              `${timeStr} – ${endStr}`,
              `Machine: ${machineName}`,
              `Cancelled by: ${cancelledByName}`,
              `Reason: ${reason || 'Maintenance'}`,
            ];
            const u = userMap.get(booking.userId as string);
            return notifyBookingCancelled(booking.userId as string, {
              message: lines.join('\n'),
              mobileNumber: u?.mobileVerified ? u.mobileNumber : null,
            });
          })
        );
      }

      // Restore package sessions for cancelled bookings
      for (const booking of bookingsToCancel) {
        const pb = await prisma.packageBooking.findUnique({
          where: { bookingId: booking.id }
        });
        if (pb) {
          await prisma.userPackage.update({
            where: { id: pb.userPackageId },
            data: { usedSessions: { decrement: pb.sessionsUsed } }
          });
        }
      }
    }

    return NextResponse.json({
      message: 'Slots blocked successfully',
      blockedSlot,
      cancelledBookingsCount: bookingsToCancel.length
    });

  } catch (error) {
    console.error('Block slots error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PUT /api/admin/slots/block - Update a blocked slot
export async function PUT(req: NextRequest) {
  try {
    const admin = await getAuthenticatedUser(req);
    if (!admin || admin.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { id, startDate, endDate, startTime, endTime, machineId, reason, appliesTo } = body;

    if (!id) {
      return NextResponse.json({ error: 'Block id is required' }, { status: 400 });
    }

    const existing = await prisma.blockedSlot.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Blocked slot not found' }, { status: 404 });
    }

    const updateData: any = {};

    if (startDate && endDate) {
      updateData.startDate = dateStringToUTC(startDate);
      updateData.endDate = dateStringToUTC(endDate);
    }

    if (startTime !== undefined && endTime !== undefined) {
      if (startTime && endTime) {
        updateData.startTime = new Date(`1970-01-01T${startTime}:00+05:30`);
        updateData.endTime = new Date(`1970-01-01T${endTime}:00+05:30`);
      } else {
        // Setting to full day
        updateData.startTime = null;
        updateData.endTime = null;
      }
    }

    if (machineId !== undefined) {
      if (machineId && isValidMachineId(machineId)) {
        updateData.machineId = machineId;
        updateData.machineType = null;
      } else if (machineId === null) {
        updateData.machineId = null;
        updateData.machineType = null;
      }
    }

    if (reason !== undefined) {
      updateData.reason = reason || null;
    }

    if (appliesTo !== undefined && ['ALL', 'SPECIAL', 'NON_SPECIAL'].includes(appliesTo)) {
      updateData.appliesTo = appliesTo;
    }

    const updated = await prisma.blockedSlot.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({ message: 'Block updated successfully', blockedSlot: updated });
  } catch (error) {
    console.error('Update blocked slot error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/admin/slots/block?id=xxx - Remove a blocked slot
export async function DELETE(req: NextRequest) {
  try {
    const admin = await getAuthenticatedUser(req);
    if (!admin || admin.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Blocked slot id is required' }, { status: 400 });
    }

    const blockedSlot = await prisma.blockedSlot.findUnique({ where: { id } });
    if (!blockedSlot) {
      return NextResponse.json({ error: 'Blocked slot not found' }, { status: 404 });
    }

    await prisma.blockedSlot.delete({ where: { id } });

    return NextResponse.json({ message: 'Block removed successfully' });
  } catch (error) {
    console.error('Delete blocked slot error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
