import { NextRequest, NextResponse } from 'next/server';
import { isValid, isSameDay } from 'date-fns';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';
import { resolveCurrentCenter } from '@/lib/centers';
import { getCenterOnlyPolicy } from '@/lib/policy';
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
  getActiveBlocksForSlot,
  applyBlocksToAvailability,
} from '@/lib/resource-booking';
import { getResourcePricingConfig, getResourceSlotPrice } from '@/lib/resource-pricing';
import { getSidearmPitchTypes, getNetPitchTypes, getEnabledBookingCategories } from '@/lib/pitch-config';
import { sanitizeApiError } from '@/lib/api-errors';
import { getOperatorCount } from '@/lib/operatorAssign';
import {
  getCenterRecurringDiscountRules,
  recurringRuleMatches,
  computeRecurringDiscountForSlot,
} from '@/lib/resource-discounts';
import { getAllApplicablePromoDiscounts } from '@/lib/promotionalOffers';
import type { BookingCategory } from '@prisma/client';

/**
 * GET /api/slots/resource-availability?date=YYYY-MM-DD[&center=<slug>]
 *
 * Slot grid for a RESOURCE_BASED center (Toplay et al.).
 *
 * Per slot, returns:
 *   - free indoor nets, free outdoor resources
 *   - free coaches, free sidearm specialist
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

    const recurringRules = await getCenterRecurringDiscountRules(center.id);
    const isSpecialUser = !!user && (user as { isSpecialUser?: boolean }).isSpecialUser === true;

    // Fetch everything we need ONCE; per-slot work is then pure JS.
    // RESOURCE_BASED centers (Toplay et al.) deliberately read every
    // booking-affecting knob from CenterPolicy ONLY — never from the
    // global Policy table. Toplay's admin sets each setting at the
    // center level; ABCA's global Policy rows must not leak in.
    const [
      slotDurationRaw,
      disabledDatesRaw,
      timeSlabConfig,
      pricingConfig,
      resources,
      coaches,
      staff,
      machines,
      sidearmPitchTypes,
      netPitchTypes,
      enabledCategories,
      bookings,
      batchConfig,
    ] = await Promise.all([
      getCenterOnlyPolicy('SLOT_DURATION', center.id, null),
      getCenterOnlyPolicy('DISABLED_DATES', center.id, null),
      getTimeSlabConfig(center.id, /* centerOnly */ true),
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
      getSidearmPitchTypes(center.id),
      getNetPitchTypes(center.id),
      getEnabledBookingCategories(center.id),
      prisma.booking.findMany({
        where: { centerId: center.id, date: dateUTC, status: { not: 'CANCELLED' } },
        select: {
          id: true,
          startTime: true,
          endTime: true,
          assignedMachineId: true,
          assignedCoachId: true,
          assignedStaffId: true,
          operatorId: true,
          category: true,
          resourceAssignments: { select: { resourceId: true } },
        },
      }),
      getCorporateBatchConfig(center.id),
    ]);

    const disabledDates = disabledDatesRaw ? disabledDatesRaw.split(',') : [];
    if (disabledDates.includes(dateStr)) {
      return NextResponse.json({ slots: [], date: dateStr, centerId: center.id });
    }

    const duration = slotDurationRaw ? parseInt(slotDurationRaw) : undefined;

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
        const slotWindow = {
          date: dateUTC,
          startTime: slot.startTime,
          endTime: slot.endTime,
        };
        const [batchNets, blocks] = await Promise.all([
          getCorporateBatchNetsForSlot(center.id, slotWindow),
          getActiveBlocksForSlot(center.id, slotWindow),
        ]);
        const baseAvailability = computeSlotAvailability({
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
          // Pass the slot so coaches/specialists outside their weekly
          // schedule don't appear as "free" for this time window.
          slot: slotWindow,
        });
        // Apply blocks: hide blocked nets/resources from the picker
        // and surface blocked categories so the client can grey out
        // the corresponding tabs. Audience is 'ALL' here — the slot
        // grid shows worst case to everyone; the actual booking call
        // re-evaluates with the user's special-status flag.
        const { availability, blockedCategories, blockedMachineRowIds } = applyBlocksToAvailability(
          baseAvailability,
          blocks,
          'ALL',
        );

        const timeSlab = getTimeSlab(slot.startTime, timeSlabConfig);

        // Operator availability for this slot (MACHINE category only).
        // Mirrors ABCA's /api/slots/available `operatorAvailable` flag.
        //   - operatorCount=0 → self-operate (no operator needed).
        //   - busyOperators >= operatorCount → MACHINE is full.
        // SIDEARM / COACHING / FULL_COURT don't consume operators, so
        // this gating only affects the MACHINE category in the UI.
        const operatorCount = await getOperatorCount(
          dateUTC,
          slot.startTime,
          timeSlabConfig,
          center.id,
        );
        const busyOperators = bookings.filter(
          (b) => b.startTime.getTime() === slot.startTime.getTime() && b.operatorId,
        ).length;
        const selfOperate = operatorCount === 0;
        const operatorAvailable = selfOperate || busyOperators < operatorCount;

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
          NET: await getResourceSlotPrice({
            category: 'NET',
            startTime: slot.startTime,
            pricingConfig,
            timeSlabConfig,
          }),
          CORPORATE_BATCH: await getResourceSlotPrice({
            category: 'CORPORATE_BATCH',
            startTime: slot.startTime,
            pricingConfig,
            timeSlabConfig,
          }),
        };

        // ── Per-category discount preview ───────────────────────────
        // For each enabled category, compute the user-visible discount
        // (₹ off this slot) from recurring rules + promotional offers.
        // Shown as a badge / used to update the displayed slot price.
        // Audience-aware (isSpecialUser); the actual booking will
        // recompute server-side — these numbers are the "preview".
        const discountsByCategory: Partial<Record<BookingCategory, {
          recurring: number;
          promo: number;
          promoName: string | null;
          total: number;
        }>> = {};

        for (const cat of enabledCategories) {
          const basePrice = prices[cat as BookingCategory] ?? 0;
          if (basePrice <= 0) continue;

          // Recurring (matched at category-level only — machineRowId is
          // resolved per-machine and folded in by the client when the
          // user picks a specific machine).
          const matched = recurringRules.filter((rule) =>
            recurringRuleMatches({
              rule,
              startTime: slot.startTime,
              category: cat,
              machineRowId: null,
            }),
          );
          const recSummary = computeRecurringDiscountForSlot({
            matches: matched,
            isConsecutive: false, // grid shows single-slot estimate
            isSpecialUser,
          });
          const recurringAmount = Math.min(recSummary.total, basePrice);

          // Promotional offers — pick the best absolute discount on this
          // slot. Filtered via the shared helper that already honours
          // category + audience + day + time + machine targeting.
          let promoAmount = 0;
          let promoName: string | null = null;
          const remaining = Math.max(0, basePrice - recurringAmount);
          if (remaining > 0) {
            const allPromos = await getAllApplicablePromoDiscounts(
              dateUTC,
              slot.startTime,
              null,
              null,
              isSpecialUser,
              null,
              cat,
              center.id,
            );
            for (const p of allPromos) {
              const d = p.discountType === 'PERCENTAGE'
                ? Math.min(remaining, Math.floor((remaining * p.discountValue) / 100))
                : Math.min(remaining, Math.floor(p.discountValue));
              if (d > promoAmount) {
                promoAmount = d;
                promoName = p.name;
              }
            }
          }

          const total = recurringAmount + promoAmount;
          if (total > 0) {
            discountsByCategory[cat] = {
              recurring: recurringAmount,
              promo: promoAmount,
              promoName,
              total,
            };
          }
        }

        // Per-machine price map: machineId → final ₹ for this slot
        // under THAT specific machine row. Two Yantra machines at the
        // same center can have different per-row prices, so we pass
        // both `machineRowId` and `machineTypeCode` to the engine —
        // the row override wins when set.
        const machinePrices: Record<string, number> = {};
        for (const m of machines) {
          machinePrices[m.id] = await getResourceSlotPrice({
            category: 'MACHINE',
            machineTypeCode: m.machineType.code,
            machineRowId: m.id,
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
          fullCourtAvailable:
            availability.fullCourtAvailable && !blockedCategories.has('FULL_COURT'),
          corporateBatchHolds: availability.corporateBatchNetsHeld,
          prices,
          machinePrices,
          // Blocks applied at this slot. The client uses these to grey
          // out blocked categories/machines in the picker without
          // re-fetching block rows.
          blockedCategories: Array.from(blockedCategories),
          blockedMachineRowIds: Array.from(blockedMachineRowIds),
          // Operator availability — only meaningful for MACHINE category.
          operatorCount,
          operatorsBusy: busyOperators,
          operatorAvailable,
          selfOperate,
          // Recurring + promo discounts by category. Empty when no rule
          // matches; client treats missing entries as 0 discount.
          discountsByCategory,
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
      // Pitch-type lists for the categories that aren't tied to a single
      // machine row. Sidearm + Net read from the per-center policies; the
      // per-machine list is fetched separately by the picker.
      sidearmPitchTypes,
      netPitchTypes,
      enabledCategories,
      // Resolved pricing config + slab boundaries — the client uses
      // these to compute the right price for the user's specific
      // (machine × pitch × ball) selection without an extra round-trip.
      pricingConfig,
      timeSlabConfig,
      corporateBatchConfig: batchConfig,
      slots: result,
    });
  } catch (error) {
    const { message, status } = sanitizeApiError(
      error,
      'slots.resource-availability',
      'Could not load slots. Please try again.',
    );
    return NextResponse.json({ error: message }, { status });
  }
}
