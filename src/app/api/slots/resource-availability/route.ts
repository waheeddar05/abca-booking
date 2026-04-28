import { NextRequest, NextResponse } from 'next/server';
import { isValid, isSameDay } from 'date-fns';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';
import { resolveCurrentCenter } from '@/lib/centers';
import { getCachedPolicies } from '@/lib/policy-cache';
import {
  generateSlotsForDateDualWindow,
  filterPastSlots,
  getISTTodayUTC,
  dateStringToUTC,
} from '@/lib/time';
import { getTimeSlabConfig, getTimeSlab } from '@/lib/pricing';
import {
  getCenterResources,
  getCenterCoaches,
  getCenterStaff,
  getCorporateBatchConfig,
  getCorporateBatchNetsForSlot,
  computeSlotAvailability,
} from '@/lib/resource-booking';
import { getResourcePricingConfig, getResourceSlotPrice } from '@/lib/resource-pricing';

/**
 * GET /api/slots/resource-availability?date=YYYY-MM-DD[&center=<slug>]
 *
 * Slot grid for a RESOURCE_BASED center (Toplay et al.).
 *
 * Per slot, returns:
 *   - free indoor nets, free outdoor resources
 *   - free coaches, free sidearm staff
 *   - whether full court is available
 *   - whether corporate batch is holding capacity
 *   - per-category prices (machine / sidearm / coaching / full-court)
 *
 * The legacy `/api/slots/available` endpoint stays in place for ABCA
 * (MACHINE_PITCH) — clients pick the endpoint based on
 * `Center.bookingModel`.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const dateStr = searchParams.get('date');
    if (!dateStr) {
      return NextResponse.json({ error: 'Date is required' }, { status: 400 });
    }
    const dateUTC = dateStringToUTC(dateStr);
    if (!isValid(dateUTC)) {
      return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
    }

    const user = await getAuthenticatedUser(req);
    const center = await resolveCurrentCenter(req, user);
    if (!center) {
      return NextResponse.json({ error: 'No center selected' }, { status: 400 });
    }
    if (center.bookingModel !== 'RESOURCE_BASED') {
      return NextResponse.json(
        {
          error: `Center "${center.name}" uses the ${center.bookingModel} booking model — call /api/slots/available instead.`,
        },
        { status: 400 },
      );
    }

    // Past dates: refuse for non-admins.
    const todayUTC = getISTTodayUTC();
    const isAdmin = user?.role === 'ADMIN' || !!user?.isSuperAdmin;
    if (!isAdmin && dateUTC < todayUTC) {
      return NextResponse.json({ slots: [], date: dateStr, centerId: center.id });
    }

    // Fetch everything we need ONCE; per-slot work is then pure JS.
    const [
      policyMap,
      timeSlabConfig,
      pricingConfig,
      resources,
      coaches,
      staff,
      machines,
      bookings,
      batchConfig,
    ] = await Promise.all([
      getCachedPolicies(['SLOT_DURATION', 'DISABLED_DATES']),
      getTimeSlabConfig(),
      getResourcePricingConfig(center.id),
      getCenterResources(center.id),
      getCenterCoaches(center.id),
      getCenterStaff(center.id),
      prisma.machine.findMany({
        where: { centerId: center.id, isActive: true },
        select: {
          id: true,
          machineType: { select: { code: true } },
        },
      }),
      prisma.booking.findMany({
        where: { centerId: center.id, date: dateUTC, status: { not: 'CANCELLED' } },
        select: {
          id: true,
          startTime: true,
          endTime: true,
          assignedMachineId: true,
          assignedCoachId: true,
          assignedStaffId: true,
          resourceAssignments: { select: { resourceId: true } },
        },
      }),
      getCorporateBatchConfig(center.id),
    ]);

    const disabledDates = policyMap['DISABLED_DATES']
      ? policyMap['DISABLED_DATES'].split(',')
      : [];
    if (disabledDates.includes(dateStr)) {
      return NextResponse.json({ slots: [], date: dateStr, centerId: center.id });
    }

    const duration = policyMap['SLOT_DURATION']
      ? parseInt(policyMap['SLOT_DURATION'])
      : undefined;

    let slots = generateSlotsForDateDualWindow(dateUTC, timeSlabConfig, duration);
    if (isSameDay(dateUTC, todayUTC)) slots = filterPastSlots(slots);

    // Build per-slot availability efficiently — we already have all bookings
    // in memory; intersect by overlap inside the loop.
    const result = await Promise.all(
      slots.map(async (slot) => {
        // Build occupancy snapshot for this slot only.
        const claimedResourceIds = new Set<string>();
        const busyCoachIds = new Set<string>();
        const busyStaffIds = new Set<string>();
        const busyMachineIds = new Set<string>();
        for (const b of bookings) {
          if (slot.startTime >= b.endTime || b.startTime >= slot.endTime) continue;
          for (const ra of b.resourceAssignments) claimedResourceIds.add(ra.resourceId);
          if (b.assignedCoachId) busyCoachIds.add(b.assignedCoachId);
          if (b.assignedStaffId) busyStaffIds.add(b.assignedStaffId);
          if (b.assignedMachineId) busyMachineIds.add(b.assignedMachineId);
        }
        const batchNets = await getCorporateBatchNetsForSlot(center.id, {
          date: dateUTC,
          startTime: slot.startTime,
          endTime: slot.endTime,
        });
        const availability = computeSlotAvailability({
          resources,
          coaches,
          staff,
          occupancy: {
            claimedResourceIds,
            busyCoachIds,
            busyStaffIds,
            busyMachineIds,
          },
          batchNets,
        });

        const timeSlab = getTimeSlab(slot.startTime, timeSlabConfig);

        // Pre-compute per-category prices. MACHINE is the base — when the
        // user picks a specific machine the UI swaps in the entry from
        // `machinePrices` below, which honours per-machine-type overrides
        // (so a Yantra at Toplay shows ₹800/₹1000 even when the default is
        // ₹600/₹800).
        const prices = {
          MACHINE: await getResourceSlotPrice({
            category: 'MACHINE',
            startTime: slot.startTime,
            pricingConfig,
            timeSlabConfig,
          }),
          SIDEARM: await getResourceSlotPrice({
            category: 'SIDEARM',
            startTime: slot.startTime,
            pricingConfig,
            timeSlabConfig,
          }),
          COACHING: await getResourceSlotPrice({
            category: 'COACHING',
            startTime: slot.startTime,
            pricingConfig,
            timeSlabConfig,
          }),
          FULL_COURT: await getResourceSlotPrice({
            category: 'FULL_COURT',
            startTime: slot.startTime,
            pricingConfig,
            timeSlabConfig,
          }),
        };

        // Per-machine price map: machineId → final ₹ for this slot under
        // that machine type. Lets the picker show "Yantra ₹800" alongside
        // "Leverage ₹600" for the same time window.
        const machinePrices: Record<string, number> = {};
        for (const m of machines) {
          machinePrices[m.id] = await getResourceSlotPrice({
            category: 'MACHINE',
            machineTypeCode: m.machineType.code,
            startTime: slot.startTime,
            pricingConfig,
            timeSlabConfig,
          });
        }

        return {
          startTime: slot.startTime.toISOString(),
          endTime: slot.endTime.toISOString(),
          timeSlab,
          freeIndoorNets: availability.freeIndoorNets.map((r) => ({
            id: r.id, name: r.name,
          })),
          freeOutdoorResources: availability.freeOutdoorResources.map((r) => ({
            id: r.id, name: r.name, type: r.type,
          })),
          freeCoaches: availability.freeCoaches.map((c) => ({
            userId: c.userId, name: c.user.name,
          })),
          freeSidearmStaff: availability.freeSidearmStaff.map((s) => ({
            userId: s.userId, name: s.user.name,
          })),
          fullCourtAvailable: availability.fullCourtAvailable,
          corporateBatchHolds: availability.corporateBatchNetsHeld,
          prices,
          machinePrices,
        };
      }),
    );

    return NextResponse.json({
      date: dateStr,
      centerId: center.id,
      centerSlug: center.slug,
      indoorNetsTotal: resources.filter((r) => r.category === 'INDOOR' && r.type === 'NET').length,
      outdoorResourcesTotal: resources.filter((r) => r.category === 'OUTDOOR').length,
      coachesTotal: coaches.length,
      sidearmStaffTotal: staff.length,
      corporateBatchConfig: batchConfig,
      slots: result,
    });
  } catch (error) {
    console.error('Resource availability error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
