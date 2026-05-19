import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser, hasMembershipRole } from '@/lib/auth';
import { dateStringToUTC, formatIST } from '@/lib/time';
import { isValidMachineId, LEATHER_MACHINES, MACHINES } from '@/lib/constants';
import { notifyBookingCancelled } from '@/lib/notifications';
import { resolveCurrentCenter } from '@/lib/centers';
import {
  adjustSiblingPricesForCancellation,
  processCancellationRefund,
} from '@/lib/booking-cancellation';
import type { Booking, MachineId, BookingCategory } from '@prisma/client';

// GET /api/admin/slots/block - List blocked slots at the admin's current center
export async function GET(req: NextRequest) {
  try {
    const admin = await getAuthenticatedUser(req);
    if (!admin || admin.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    // Per-center gate: a global ADMIN at center A must not be able
    // to block / unblock slots at center B. resolveCurrentCenter is
    // also called downstream — we just inline the membership check
    // here. Super admin bypasses.
    {
      const cur = await resolveCurrentCenter(req, admin);
      if (cur && !admin.isSuperAdmin && !hasMembershipRole(admin, cur.id, 'ADMIN')) {
        return NextResponse.json({ error: "You're not an admin at this center" }, { status: 403 });
      }
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
      machineId,    // Legacy: specific MachineId enum (single)
      machineIds,   // Legacy: multiple MachineId enum strings
      recurringDays, // array of day-of-week numbers (0=Sun, 1=Mon, ..., 6=Sat)
      pitchType,
      reason,
      appliesTo,
      // RESOURCE_BASED targeting axes (Toplay). Each is optional and
      // defaults to "no filter on this axis" when empty.
      machineRowIds, // Machine.id FKs
      resourceIds,   // Resource.id FKs (block specific nets/wickets)
      categories,    // BookingCategory[] (block all SIDEARM, etc.)
      netCount,      // Partial cricket-net cap (positive int or null)
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

    // Validate RESOURCE_BASED targeting axes. We don't error on a
    // mismatched booking model — the engine ignores irrelevant fields,
    // and a super admin might be authoring multi-axis blocks. We only
    // strip values that don't reference real rows at this center.
    let validatedMachineRowIds: string[] = [];
    if (Array.isArray(machineRowIds) && machineRowIds.length > 0) {
      const rows = await prisma.machine.findMany({
        where: { id: { in: machineRowIds.filter((x) => typeof x === 'string') }, centerId: center.id },
        select: { id: true },
      });
      validatedMachineRowIds = rows.map((r) => r.id);
    }
    let validatedResourceIds: string[] = [];
    if (Array.isArray(resourceIds) && resourceIds.length > 0) {
      const rows = await prisma.resource.findMany({
        where: { id: { in: resourceIds.filter((x) => typeof x === 'string') }, centerId: center.id },
        select: { id: true },
      });
      validatedResourceIds = rows.map((r) => r.id);
    }
    const validBookingCategories = ['MACHINE', 'SIDEARM', 'COACHING', 'NET', 'FULL_COURT', 'CORPORATE_BATCH'];
    const validatedCategories: string[] = Array.isArray(categories)
      ? categories.filter((c) => typeof c === 'string' && validBookingCategories.includes(c))
      : [];

    // Validate the partial cricket-net cap. Coerce non-numeric / non-
    // positive values to null so legacy clients that send `0` or `""`
    // get the "block all nets" behaviour. Positive integers are clamped
    // to the indoor-net pool size to keep the engine's bookkeeping
    // consistent.
    let validatedNetCount: number | null = null;
    if (typeof netCount === 'number' && Number.isFinite(netCount) && netCount > 0) {
      const indoorTotal = await prisma.resource.count({
        where: { centerId: center.id, type: 'NET', category: 'INDOOR', isActive: true },
      });
      validatedNetCount = Math.min(Math.floor(netCount), Math.max(1, indoorTotal));
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
        machineRowIds: validatedMachineRowIds,
        resourceIds: validatedResourceIds,
        categories: validatedCategories as any,
        netCount: validatedNetCount,
      },
    });

    // 2. Find conflicting bookings. The query is scoped to the block's
    // center so we never accidentally cancel bookings from a sibling
    // center the admin doesn't own. Targeting follows two paths in
    // parallel:
    //   - Legacy (ABCA / MACHINE_PITCH): machineType / machineId /
    //     pitchType axes on the Booking row.
    //   - Resource-based (Toplay): category / assignedMachineId /
    //     resource assignments. FULL_COURT blocks cascade to every
    //     indoor-pool category (NET / SIDEARM / MACHINE / FULL_COURT).
    const where: Record<string, unknown> = {
      centerId: center.id,
      date: { gte: start, lte: end },
      status: 'BOOKED',
    };

    if (validatedMachineIds.length > 0) {
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

    // Resource-based axes — only narrow when the block actually targets
    // them. Categories include the FULL_COURT cascade (NET / SIDEARM /
    // MACHINE all get cancelled by a Full-Court block) so the conflict
    // set matches what the availability engine now refuses to book.
    const hasResourceBasedTargeting =
      validatedMachineRowIds.length > 0
      || validatedResourceIds.length > 0
      || validatedCategories.length > 0;

    if (hasResourceBasedTargeting) {
      const orClauses: Record<string, unknown>[] = [];

      // Effective category set with FULL_COURT cascade applied. Mirrors
      // applyBlocksToAvailability / evaluateBlockForBooking so any
      // booking the user can't make is the same set we cancel here.
      const effectiveCategories = new Set<string>(validatedCategories);
      if (effectiveCategories.has('FULL_COURT') && validatedResourceIds.length === 0) {
        effectiveCategories.add('NET');
        effectiveCategories.add('SIDEARM');
        effectiveCategories.add('MACHINE');
      }
      if (effectiveCategories.size > 0) {
        orClauses.push({ category: { in: Array.from(effectiveCategories) as BookingCategory[] } });
      }

      if (validatedMachineRowIds.length > 0) {
        orClauses.push({ assignedMachineId: { in: validatedMachineRowIds } });
      }

      if (validatedResourceIds.length > 0) {
        orClauses.push({
          resourceAssignments: { some: { resourceId: { in: validatedResourceIds } } },
        });
      }

      if (orClauses.length > 0) {
        // OR with any legacy axes already on `where` so a multi-model
        // block still nets the union of conflicts.
        if (where.OR) {
          where.OR = [...(where.OR as Record<string, unknown>[]), ...orClauses];
        } else {
          where.OR = orClauses;
        }
      }
    }

    const conflictingBookings: Booking[] = await prisma.booking.findMany({ where });

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

    // Partial cricket-net block: only cancel the OLDEST `netCount`
    // bookings that overlap. The newer ones stay — they'll fit into
    // the remaining capacity. Without this gate, a "block 1 net at
    // 9 AM" command would cancel every Cricket Net booking at 9 AM,
    // which is the bug task 5 is fixing.
    let bookingsToReallyCancel = bookingsToCancel;
    if (
      validatedNetCount != null
      && validatedNetCount > 0
      && validatedCategories.includes('NET')
      && validatedResourceIds.length === 0
    ) {
      // Sort oldest-first so the deterministic pick is the historical one.
      const sorted = [...bookingsToCancel].sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
      );
      // Only NET bookings consume the partial-net cap.
      const netBookings = sorted.filter((b) => b.category === 'NET');
      const others = sorted.filter((b) => b.category !== 'NET');
      bookingsToReallyCancel = [...netBookings.slice(0, validatedNetCount), ...others];
    }

    // 3. Cancel each conflicting booking via the shared refund helper.
    // The helper handles every payment flavour:
    //   - WALLET-paid → wallet credit
    //   - ONLINE-paid → wallet credit or Razorpay refund per center policy
    //   - Package redemption → no monetary refund (session restored below)
    //   - FREE / CASH → no monetary refund
    // We never block the API on a single refund failure — failures are
    // captured and returned alongside the success summary.
    const cancelledByName = `Admin (${admin.name || admin.id})`;
    const cancellationReason = `Cancelled by Admin - ${reason || 'Block applied'}`;
    const refundResults: Array<{
      bookingId: string;
      method?: 'WALLET' | 'RAZORPAY';
      amount?: number;
      error?: string;
    }> = [];

    for (const booking of bookingsToReallyCancel) {
      try {
        // Reprice consecutive siblings first so the cancelled booking's
        // refundable amount reflects the lost discount on its siblings.
        await adjustSiblingPricesForCancellation(booking).catch((e) => {
          console.warn(`[block.cancel] sibling reprice failed for booking=${booking.id}:`, e);
          return 0;
        });

        await prisma.booking.update({
          where: { id: booking.id },
          data: {
            status: 'CANCELLED',
            cancelledBy: cancelledByName,
            cancellationReason,
          },
        });

        if (booking.userId) {
          const refund = await processCancellationRefund({
            booking,
            initiatedByUserId: admin.id,
            initiatedByName: cancelledByName,
          });
          if (refund) {
            refundResults.push({
              bookingId: booking.id,
              method: refund.method,
              amount: refund.amount,
            });
          } else {
            refundResults.push({ bookingId: booking.id });
          }
        }

        // Restore package sessions when the cancelled booking redeemed one.
        const pb = await prisma.packageBooking.findUnique({
          where: { bookingId: booking.id },
        });
        if (pb) {
          await prisma.userPackage.update({
            where: { id: pb.userPackageId },
            data: { usedSessions: { decrement: pb.sessionsUsed } },
          });
        }

        // Best-effort cancellation notification.
        if (booking.userId) {
          try {
            const dateStr = formatIST(new Date(booking.date), 'EEE, dd MMM yyyy');
            const timeStr = formatIST(new Date(booking.startTime), 'hh:mm a');
            const endStr = formatIST(new Date(booking.endTime), 'hh:mm a');
            const machineName = booking.machineId
              ? (MACHINES[booking.machineId]?.shortName || booking.machineId)
              : (booking.ballType ?? booking.category ?? 'Session');
            const u = await prisma.user.findUnique({
              where: { id: booking.userId },
              select: { mobileNumber: true, mobileVerified: true },
            });
            await notifyBookingCancelled(booking.userId, {
              message: [
                `${dateStr}`,
                `${timeStr} – ${endStr}`,
                `Machine: ${machineName}`,
                `Cancelled by: ${cancelledByName}`,
                `Reason: ${reason || 'Block applied'}`,
              ].join('\n'),
              mobileNumber: u?.mobileVerified ? u.mobileNumber : null,
            });
          } catch (notifErr) {
            console.warn(`[block.cancel] notify failed for booking=${booking.id}:`, notifErr);
          }
        }
      } catch (cancelErr) {
        const msg = cancelErr instanceof Error ? cancelErr.message : String(cancelErr);
        console.error(`[block.cancel] failed to cancel booking=${booking.id}:`, cancelErr);
        refundResults.push({ bookingId: booking.id, error: msg });
      }
    }

    return NextResponse.json({
      message: 'Slots blocked successfully',
      blockedSlot,
      cancelledBookingsCount: bookingsToReallyCancel.length,
      refundResults,
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
    // Per-center gate: a global ADMIN at center A must not be able
    // to block / unblock slots at center B. resolveCurrentCenter is
    // also called downstream — we just inline the membership check
    // here. Super admin bypasses.
    {
      const cur = await resolveCurrentCenter(req, admin);
      if (cur && !admin.isSuperAdmin && !hasMembershipRole(admin, cur.id, 'ADMIN')) {
        return NextResponse.json({ error: "You're not an admin at this center" }, { status: 403 });
      }
    }

    const body = await req.json();
    const {
      id,
      startDate,
      endDate,
      startTime,
      endTime,
      machineId,
      reason,
      appliesTo,
      // RESOURCE_BASED targeting axes — accepted on the PUT path too so
      // Toplay's edit dialog can round-trip every field that was set on
      // creation.
      machineRowIds,
      resourceIds,
      categories,
      recurringDays,
      netCount,
    } = body;

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

    if (Array.isArray(recurringDays)) {
      updateData.recurringDays = recurringDays
        .filter((d: unknown) => typeof d === 'number' && d >= 0 && d <= 6);
    }

    // RESOURCE_BASED axes — only accept rows that actually belong to
    // this block's center, mirroring the validation in POST.
    if (Array.isArray(machineRowIds)) {
      if (machineRowIds.length === 0) {
        updateData.machineRowIds = [];
      } else {
        const rows = await prisma.machine.findMany({
          where: {
            id: { in: machineRowIds.filter((x: unknown) => typeof x === 'string') },
            centerId: existing.centerId,
          },
          select: { id: true },
        });
        updateData.machineRowIds = rows.map((r) => r.id);
      }
    }
    if (Array.isArray(resourceIds)) {
      if (resourceIds.length === 0) {
        updateData.resourceIds = [];
      } else {
        const rows = await prisma.resource.findMany({
          where: {
            id: { in: resourceIds.filter((x: unknown) => typeof x === 'string') },
            centerId: existing.centerId,
          },
          select: { id: true },
        });
        updateData.resourceIds = rows.map((r) => r.id);
      }
    }
    if (Array.isArray(categories)) {
      const validBookingCategories = ['MACHINE', 'SIDEARM', 'COACHING', 'NET', 'FULL_COURT', 'CORPORATE_BATCH'];
      updateData.categories = categories.filter(
        (c: unknown): c is string => typeof c === 'string' && validBookingCategories.includes(c),
      );
    }

    // Partial cricket-net cap: explicit null clears the override; a
    // positive integer overwrites it. Anything else is left untouched
    // so legacy PUT payloads without the field keep working.
    if (netCount === null) {
      updateData.netCount = null;
    } else if (typeof netCount === 'number' && Number.isFinite(netCount) && netCount > 0) {
      const indoorTotal = await prisma.resource.count({
        where: { centerId: existing.centerId, type: 'NET', category: 'INDOOR', isActive: true },
      });
      updateData.netCount = Math.min(Math.floor(netCount), Math.max(1, indoorTotal));
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
    // Per-center gate: a global ADMIN at center A must not be able
    // to block / unblock slots at center B. resolveCurrentCenter is
    // also called downstream — we just inline the membership check
    // here. Super admin bypasses.
    {
      const cur = await resolveCurrentCenter(req, admin);
      if (cur && !admin.isSuperAdmin && !hasMembershipRole(admin, cur.id, 'ADMIN')) {
        return NextResponse.json({ error: "You're not an admin at this center" }, { status: 403 });
      }
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
