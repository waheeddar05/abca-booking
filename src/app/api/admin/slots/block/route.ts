import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser, hasMembershipRole } from '@/lib/auth';
import { dateStringToUTC, formatIST } from '@/lib/time';
import { isValidMachineId, LEATHER_MACHINES } from '@/lib/constants';
import { notifyBookingCancelled, notifyAssignedStaffBookingCancelled, buildCancellationDetailLines } from '@/lib/notifications';
import { resolveCurrentCenter } from '@/lib/centers';
import {
  adjustSiblingPricesForCancellation,
  processCancellationRefund,
} from '@/lib/booking-cancellation';
import type { Booking, MachineId, BookingCategory } from '@prisma/client';

// Total bookable capacity (sum of unit capacities) of a pitch's surface
// at a center. ASTRO → indoor nets (NET); NATURAL → TURF_WICKET; CEMENT →
// CEMENT_WICKET. Used to clamp count blocks so "block N of M units" can't
// exceed the pitch's real capacity — and so a single high-capacity row
// (one "Astro Turf" with capacity 4) still allows blocking up to 4.
async function pitchPoolCapacity(centerId: string, pitchType: unknown): Promise<number> {
  const pitch = typeof pitchType === 'string' ? pitchType : 'ASTRO';
  const type = pitch === 'NATURAL' ? 'TURF_WICKET' : pitch === 'CEMENT' ? 'CEMENT_WICKET' : 'NET';
  const agg = await prisma.resource.aggregate({
    where: { centerId, type: type as 'NET' | 'TURF_WICKET' | 'CEMENT_WICKET', isActive: true },
    _sum: { capacity: true },
  });
  return agg._sum.capacity ?? 0;
}

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

    // Resolve the admin who created each block so the Active Blocks table
    // can show a "Blocked By" name instead of a raw user id. blockedBy
    // stores a User.id; a few legacy rows may store a free-form name, so
    // we fall back to the stored value when no user matches.
    const blockerIds = [...new Set(blockedSlots.map((b) => b.blockedBy).filter(Boolean))];
    const blockers = blockerIds.length
      ? await prisma.user.findMany({
          where: { id: { in: blockerIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
    const blockerById = new Map(blockers.map((u) => [u.id, u.name || u.email]));
    const withNames = blockedSlots.map((b) => ({
      ...b,
      blockedByName: blockerById.get(b.blockedBy) || b.blockedBy || null,
    }));

    return NextResponse.json(withNames);
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
      // Preview/confirmation flag. When true the route resolves the set
      // of bookings this block WOULD cancel and returns the count (plus a
      // short summary of each) WITHOUT creating the block or cancelling
      // anything. The admin UI calls this first so it can show a
      // confirmation popup before committing an overlapping block.
      dryRun,
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
    // Keep this list in sync with the BookingCategory enum. A category
    // missing here is SILENTLY STRIPPED from the block — which is worse
    // than a validation error: a block that only targeted the stripped
    // category loses its last axis and becomes a catchall that blocks
    // EVERY booking in the window (the bug that hit MATCH_SIMULATION
    // when it wasn't listed).
    const validBookingCategories = ['MACHINE', 'SIDEARM', 'COACHING', 'NET', 'FULL_COURT', 'CORPORATE_BATCH', 'MATCH_SIMULATION'];
    const validatedCategories: string[] = Array.isArray(categories)
      ? categories.filter((c) => typeof c === 'string' && validBookingCategories.includes(c))
      : [];

    // Validate the count block (reserve N units of a pitch pool). Coerce
    // non-numeric / non-positive values to null ("block all"). Positive
    // integers are clamped to the selected pitch's TOTAL CAPACITY (sum of
    // unit capacities), not the resource row count — one "Astro Turf" row
    // with capacity 4 must allow blocking up to 4 units.
    let validatedNetCount: number | null = null;
    if (typeof netCount === 'number' && Number.isFinite(netCount) && netCount > 0) {
      validatedNetCount = Math.min(
        Math.floor(netCount),
        Math.max(1, await pitchPoolCapacity(center.id, pitchType)),
      );
    }

    // 1. Find conflicting bookings BEFORE creating anything. The query is
    // scoped to the block's
    // center so we never accidentally cancel bookings from a sibling
    // center the admin doesn't own. Targeting follows two paths in
    // parallel:
    //   - Legacy (ABCA / MACHINE_PITCH): machineType / machineId /
    //     pitchType axes on the Booking row.
    //   - Resource-based (Toplay): category / assignedMachineId /
    //     resource assignments. FULL_COURT blocks cascade to every
    //     indoor-pool category (NET / SIDEARM / MACHINE / FULL_COURT).
    // Task: machineId-targeted blocks should ONLY cancel bookings for
    // THAT specific machine.
    const where: Record<string, unknown> = {
      centerId: center.id,
      date: { gte: start, lte: end },
      status: 'BOOKED',
      // Monthly / half-month corporate-batch ENROLLMENTS are month-long
      // memberships whose Booking row is merely anchored on the first
      // session date — a block covering that one date must not cancel
      // (and refund) the whole membership. Regular (per-session) rows
      // and every other category still cancel normally. Mirrors the
      // enrollment exemption in the booking route's block pre-flight.
      NOT: { corporateBatchMode: { in: ['MONTHLY', 'HALF_MONTH'] } },
    };

    if (validatedMachineIds.length > 0) {
      where.OR = [
        { machineId: { in: validatedMachineIds } },
        { assignedMachineId: { in: validatedMachineIds } }
      ];
    } else if (validatedMachineId) {
      where.OR = [
        { machineId: validatedMachineId },
        { assignedMachineId: validatedMachineId }
      ];
    } else if (machineType) {
      if (machineType === 'LEATHER' || machineType === 'MACHINE') {
        where.OR = [
          { ballType: { in: ['LEATHER', 'MACHINE'] } },
          { machineId: { in: LEATHER_MACHINES } },
          { assignedMachineId: { not: null } }
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
      // Each specified resource-based axis is a REQUIRED condition: a
      // booking is only a conflict when it matches the category AND the
      // machine AND the resource AND the pitch the block targets. This
      // mirrors evaluateBlockForBooking's AND semantics so we never
      // cancel more than the block actually takes off the board — e.g.
      // a "Yantra on Natural Turf" block must not cancel Yantra on Astro
      // (different pitch) nor every machine on Natural (different
      // machine). The pitch axis is already on `where.pitchType` above.
      const andClauses: Record<string, unknown>[] = [];

      // Each category is independent — a FULL_COURT block cancels only
      // FULL_COURT bookings, a SIDEARM block only SIDEARM, etc. No
      // cascade: mirrors applyBlocksToAvailability / evaluateBlockForBooking
      // so the set we cancel matches exactly what the engine now refuses
      // to book.
      const effectiveCategories = new Set<string>(validatedCategories);
      if (effectiveCategories.size > 0) {
        andClauses.push({ category: { in: Array.from(effectiveCategories) as BookingCategory[] } });
      }

      if (validatedMachineRowIds.length > 0) {
        andClauses.push({ assignedMachineId: { in: validatedMachineRowIds } });
      }

      if (validatedResourceIds.length > 0) {
        andClauses.push({
          resourceAssignments: { some: { resourceId: { in: validatedResourceIds } } },
        });
      }

      if (andClauses.length > 0) {
        // AND the resource-based conditions together. If a legacy OR set
        // already exists (super-admin authoring a cross-model block), the
        // resource-based conditions still apply on top via where.AND —
        // Prisma combines top-level OR and AND with an implicit AND.
        where.AND = andClauses;
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

    // Count block (reserve N units of a pitch pool): only cancel the
    // OLDEST `netCount` overlapping bookings — the rest fit within the
    // remaining capacity. The conflict query above is already scoped to
    // the block's pitch, so these are the bookings competing for the
    // reserved units. Without this gate a "block 1 unit" command would
    // cancel every booking on the pitch.
    let bookingsToReallyCancel = bookingsToCancel;
    const isCountBlock =
      validatedNetCount != null
      && validatedNetCount > 0
      && validatedMachineRowIds.length === 0
      && validatedResourceIds.length === 0;
    if (isCountBlock) {
      // Sort oldest-first so the deterministic pick is the historical one.
      const sorted = [...bookingsToCancel].sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
      );
      bookingsToReallyCancel = sorted.slice(0, validatedNetCount!);
    }

    // 2. Dry run: the caller only wants to know what this block WOULD
    // cancel so it can show a confirmation popup. Report the count and a
    // short summary of each affected booking, then bail out without
    // creating the block or cancelling anything.
    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        cancelledBookingsCount: bookingsToReallyCancel.length,
        bookings: bookingsToReallyCancel.map((b) => ({
          id: b.id,
          playerName: b.playerName,
          date: b.date,
          startTime: b.startTime,
          endTime: b.endTime,
          machineId: b.machineId,
          category: b.category,
        })),
      });
    }

    // 3. Commit the block. Persisted only after conflict detection so a
    // dry-run preview never leaves a row behind.
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

    // 4. Cancel each conflicting booking via the shared refund helper.
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
            requestedRefundMethod: 'WALLET', // Force refund to wallet as requested
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
            // Category-aware detail line(s): machine for MACHINE bookings,
            // specialist/coach for SIDEARM/COACHING, type-only for the
            // rest. Never leaks the TENNIS ballType default as a fake
            // "Machine".
            const detailLines = await buildCancellationDetailLines(booking.id);
            const u = await prisma.user.findUnique({
              where: { id: booking.userId },
              select: { mobileNumber: true, mobileVerified: true },
            });
            await notifyBookingCancelled(booking.userId, {
              message: [
                `${dateStr}`,
                `${timeStr} – ${endStr}`,
                ...detailLines,
                `Cancelled by: ${cancelledByName}`,
                `Reason: ${reason || 'Block applied'}`,
              ].join('\n'),
              mobileNumber: u?.mobileVerified ? u.mobileNumber : null,
              centerId: booking.centerId,
              bookingId: booking.id,
            });
          } catch (notifErr) {
            console.warn(`[block.cancel] notify failed for booking=${booking.id}:`, notifErr);
          }
        }

        // Notify the assigned service provider(s) — operator / coach /
        // sidearm specialist / ground staff — that their session was
        // cancelled by the block. Never throws.
        await notifyAssignedStaffBookingCancelled(booking.id, {
          cancelledBy: cancelledByName,
          reason: reason || 'Slot blocked',
        });
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
      pitchType,
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

    if (pitchType !== undefined) {
      updateData.pitchType = pitchType || null;
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
      // Same list as POST — a stripped category can silently widen the
      // block into a catchall (see the comment there).
      const validBookingCategories = ['MACHINE', 'SIDEARM', 'COACHING', 'NET', 'FULL_COURT', 'CORPORATE_BATCH', 'MATCH_SIMULATION'];
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
      // Clamp to the selected pitch's total capacity (body pitch wins,
      // else the block's existing pitch).
      const pitchForCount = pitchType !== undefined ? pitchType : existing.pitchType;
      updateData.netCount = Math.min(
        Math.floor(netCount),
        Math.max(1, await pitchPoolCapacity(existing.centerId, pitchForCount)),
      );
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
