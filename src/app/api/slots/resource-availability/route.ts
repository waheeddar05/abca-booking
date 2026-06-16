import { NextRequest, NextResponse } from 'next/server';
import { isValid, isSameDay } from 'date-fns';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';
import { resolveCurrentCenter } from '@/lib/centers';
import { getCenterOnlyPolicy } from '@/lib/policy';
import { expireStaleHolds } from '@/lib/booking-hold';
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
  getDayCandidateBlocks,
  filterBlocksForSlotSync,
  applyBlocksToAvailability,
  applyPitchReservations,
} from '@/lib/resource-booking';
import { getResourcePricingConfig, getResourceSlotPrice, representativeCategoryBase } from '@/lib/resource-pricing';
import { getSidearmPitchTypes, getNetPitchTypes, getCoachingPitchTypes, getEnabledBookingCategories } from '@/lib/pitch-config';
import { sanitizeApiError } from '@/lib/api-errors';
import { getOperatorCount } from '@/lib/operatorAssign';
import {
  getCenterRecurringDiscountRules,
  recurringRuleMatches,
  computeRecurringDiscountForSlot,
} from '@/lib/resource-discounts';
import { timeToMinutes } from '@/lib/pricing';
import type { BookingCategory } from '@prisma/client';

/** IST day-of-week (0=Sun..6=Sat). */
function getDayOfWeekIST(d: Date): number {
  return new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })).getDay();
}

/** IST minutes-of-day for a Date. Used to compare against offer time
 *  windows stored as HH:MM strings. */
function getMinutesOfDayIST(d: Date): number {
  const istStr = d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false });
  const [h, m] = istStr.split(':').map(Number);
  return h * 60 + m;
}

/** HH:MM string → minutes since midnight. */
function timeStrToMinutes(s: string): number {
  return timeToMinutes(s);
}

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

    // Lazily expire stale unpaid holds (reserve-then-confirm) so an
    // abandoned reservation never keeps a slot/resource locked. No-op when
    // the center has no holds (RESERVE_BEFORE_PAYMENT off).
    await expireStaleHolds(center.id).catch(() => {});

    // Past dates: refuse for non-admins.
    const todayUTC = getISTTodayUTC();
    const isAdmin = user?.role === 'ADMIN' || !!user?.isSuperAdmin;
    if (!isAdmin && dateUTC < todayUTC) {
      return NextResponse.json({ slots: [], date: dateStr, centerId: center.id });
    }

    const recurringRules = await getCenterRecurringDiscountRules(center.id);
    const isSpecialUser = !!user && (user as { isSpecialUser?: boolean }).isSpecialUser === true;

    // Promotional offers — fetched ONCE per request and filtered
    // synchronously below. Previously the per-slot, per-category
    // discount preview called getAllApplicablePromoDiscounts() inside
    // a nested loop, which round-tripped to the DB ~120 times per page
    // load on a 24-slot × 5-category center. Combined with Neon's cold-
    // start latency, that turned the slot grid into a 10s+ experience.
    const activePromoOffers = await prisma.promotionalOffer.findMany({
      where: {
        centerId: center.id,
        isActive: true,
        startDate: { lte: dateUTC },
        endDate: { gte: dateUTC },
      },
    });

    // Prefetch the day's BlockedSlot candidates once. Per-slot filter
    // (dow + time overlap) happens synchronously inside the slot loop
    // via `filterBlocksForSlotSync`. Saves N round-trips against the
    // same date-range query.
    const candidateBlocks = await getDayCandidateBlocks(center.id, dateUTC);

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
      coachingPitchTypes,
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
      getCoachingPitchTypes(center.id),
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
        // Build occupancy snapshot for this slot only. resourceLoad
        // tracks bookings per resource so capacity > 1 can host more
        // than one concurrent session; computeSlotAvailability rederives
        // `claimedResourceIds` from (load, resource.capacity).
        const resourceLoad = new Map<string, number>();
        const busyCoachIds = new Set<string>();
        const busyStaffIds = new Set<string>();
        const busyMachineIds = new Set<string>();
        let hasFullCourtBooking = false;
        for (const b of bookings) {
          if (slot.startTime >= b.endTime || b.startTime >= slot.endTime) continue;
          for (const ra of b.resourceAssignments) {
            resourceLoad.set(ra.resourceId, (resourceLoad.get(ra.resourceId) ?? 0) + 1);
          }
          if (b.assignedCoachId) busyCoachIds.add(b.assignedCoachId);
          if (b.assignedStaffId) busyStaffIds.add(b.assignedStaffId);
          if (b.assignedMachineId) busyMachineIds.add(b.assignedMachineId);
          // FULL_COURT booking overlapping the slot locks the entire
          // indoor net pool — see resource-booking.ts computeSlotAvailability.
          if (b.category === 'FULL_COURT') hasFullCourtBooking = true;
        }
        // Seed the legacy `claimedResourceIds` view; computeSlotAvailability
        // overwrites it with a capacity-aware version below.
        const claimedResourceIds = new Set<string>(resourceLoad.keys());
        const slotWindow = {
          date: dateUTC,
          startTime: slot.startTime,
          endTime: slot.endTime,
        };
        // Corporate batch — was a per-slot async call into the same
        // policy (already prefetched as `batchConfig`). Inline the
        // overlap check so we don't hit the policy cache per slot.
        const batchNets = (() => {
          if (!batchConfig.enabled || batchConfig.netsConsumed <= 0) return 0;
          const dow = getDayOfWeekIST(slotWindow.startTime);
          if (batchConfig.days.length > 0 && !batchConfig.days.includes(dow)) return 0;

          const startMin = getMinutesOfDayIST(slotWindow.startTime);
          const endMin = getMinutesOfDayIST(slotWindow.endTime);

          const batchStartMin = timeStrToMinutes(batchConfig.startTime);
          const batchEndMin = timeStrToMinutes(batchConfig.endTime);

          if (endMin <= batchStartMin) return 0;
          if (startMin >= batchEndMin) return 0;
          return batchConfig.netsConsumed;
        })();
        const blocks = filterBlocksForSlotSync(candidateBlocks, slotWindow);
        // Hold admin "count blocks" (block N units of a pitch) as virtual
        // load before availability is computed, so the pool reflects the
        // reserved units exactly like real bookings. Grid view uses 'ALL'
        // (worst case); booking re-evaluates with the user's audience.
        applyPitchReservations(resourceLoad, resources, blocks, 'ALL');
        const baseAvailability = computeSlotAvailability({
          resources,
          coaches,
          staff,
          occupancy: {
            resourceLoad,
            claimedResourceIds,
            busyCoachIds,
            busyStaffIds,
            busyMachineIds,
            hasFullCourtBooking,
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
        const { availability, blockedCategories, blockedMachineRowIds, blockedByPitch } = applyBlocksToAvailability(
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
        const slotDayOfWeek = getDayOfWeekIST(slot.startTime);
        const slotMinutes = getMinutesOfDayIST(slot.startTime);
        const discountsByCategory: Partial<Record<BookingCategory, {
          recurring: number;
          promo: number;
          promoName: string | null;
          total: number;
        }>> = {};

        for (const cat of enabledCategories) {
          // The no-pitch category default is 0 for per-pitch-priced
          // categories (SIDEARM / NET / COACHING). Fall back to the best
          // configured per-pitch rate so their discount preview isn't
          // skipped — otherwise an "all categories" offer only shows on
          // MACHINE. See `representativeCategoryBase`.
          let basePrice = prices[cat as BookingCategory] ?? 0;
          if (basePrice <= 0) {
            basePrice = representativeCategoryBase(cat as BookingCategory, pricingConfig, timeSlab);
          }
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

          // Promotional offers — filter the prefetched list in-memory.
          // Mirrors getAllApplicablePromoDiscounts but with category +
          // audience + slot context applied here so we don't pay the
          // round-trip per (slot × category).
          let promoAmount = 0;
          let promoName: string | null = null;
          const remaining = Math.max(0, basePrice - recurringAmount);
          if (remaining > 0) {
            for (const offer of activePromoOffers) {
              // Audience gate
              if (offer.appliesTo === 'SPECIAL' && !isSpecialUser) continue;
              if (offer.appliesTo === 'NON_SPECIAL' && isSpecialUser) continue;
              // Day-of-week gate
              if (offer.days && offer.days.length > 0 && !offer.days.includes(slotDayOfWeek)) continue;
              // Time-of-day gate (offer.timeSlotStart / End are HH:MM strings)
              if (offer.timeSlotStart && offer.timeSlotEnd) {
                const oStart = timeStrToMinutes(offer.timeSlotStart);
                const oEnd = timeStrToMinutes(offer.timeSlotEnd);
                if (slotMinutes < oStart || slotMinutes >= oEnd) continue;
              }
              // Category gate — non-empty list means "only these
              // categories". Empty list means "any category".
              if (offer.categories && offer.categories.length > 0
                && !offer.categories.includes(cat as any)) continue;
              // Resource-row gate: machine-row-pinned offers are
              // handled below in `machineDiscounts` (per machineId)
              // so the user can see them when they pick that specific
              // machine. The category-level preview here intentionally
              // ignores them for MACHINE category so the discount
              // doesn't appear for the wrong machine. For other
              // categories (SIDEARM, etc.), we ignore this gate so an
              // "All Categories" offer can apply even if some machines
              // are pinned.
              if (cat === 'MACHINE' && offer.machineRowIds && offer.machineRowIds.length > 0) continue;

              const d = offer.discountType === 'PERCENTAGE'
                ? Math.min(remaining, Math.floor((remaining * offer.discountValue) / 100))
                : Math.min(remaining, Math.floor(offer.discountValue));
              if (d > promoAmount) {
                promoAmount = d;
                promoName = offer.name;
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

        // Per-machine discount preview. Promotional offers that pin
        // to specific machineRowIds were skipped in the category-level
        // preview above (no way to know which machine the user picks
        // there). Here we evaluate each machine row independently so
        // when the user picks Yantra 2 the discount for "Yantra 2
        // weekend offer" shows up on the slot cards. The category
        // bucket (`discountsByCategory.MACHINE`) acts as the floor —
        // a global MACHINE offer applies to every machine; a
        // machine-row offer adds to it only for the matching row.
        const machineDiscounts: Record<string, {
          recurring: number;
          promo: number;
          promoName: string | null;
          total: number;
        }> = {};
        const machineCategoryFloor = discountsByCategory.MACHINE ?? {
          recurring: 0, promo: 0, promoName: null, total: 0,
        };
        for (const m of machines) {
          const mBase = machinePrices[m.id];
          if (mBase <= 0) continue;

          // Recurring rules matched to this machine row.
          const mMatched = recurringRules.filter((rule) =>
            recurringRuleMatches({
              rule,
              startTime: slot.startTime,
              category: 'MACHINE',
              machineRowId: m.id,
            }),
          );
          const mRecSummary = computeRecurringDiscountForSlot({
            matches: mMatched,
            isConsecutive: false,
            isSpecialUser,
          });
          const mRecurring = Math.min(mRecSummary.total, mBase);

          // Promo offers — both center-wide (empty machineRowIds, gated
          // out of the category preview here? no — those WERE counted
          // above; we re-evaluate so the per-machine bucket is the
          // single source of truth) and row-pinned offers that match
          // this machine.
          let mPromo = 0;
          let mPromoName: string | null = null;
          const mRemaining = Math.max(0, mBase - mRecurring);
          if (mRemaining > 0) {
            for (const offer of activePromoOffers) {
              if (offer.appliesTo === 'SPECIAL' && !isSpecialUser) continue;
              if (offer.appliesTo === 'NON_SPECIAL' && isSpecialUser) continue;
              if (offer.days && offer.days.length > 0 && !offer.days.includes(slotDayOfWeek)) continue;
              if (offer.timeSlotStart && offer.timeSlotEnd) {
                const oStart = timeStrToMinutes(offer.timeSlotStart);
                const oEnd = timeStrToMinutes(offer.timeSlotEnd);
                if (slotMinutes < oStart || slotMinutes >= oEnd) continue;
              }
              // Category gate: empty = all categories; otherwise must
              // include MACHINE since this loop only previews MACHINE
              // bookings against the picked machine row.
              if (offer.categories && offer.categories.length > 0
                && !offer.categories.includes('MACHINE')) continue;
              // Machine-row gate: empty = applies to every machine;
              // otherwise must include THIS row.
              if (offer.machineRowIds && offer.machineRowIds.length > 0
                && !offer.machineRowIds.includes(m.id)) continue;

              const d = offer.discountType === 'PERCENTAGE'
                ? Math.min(mRemaining, Math.floor((mRemaining * offer.discountValue) / 100))
                : Math.min(mRemaining, Math.floor(offer.discountValue));
              if (d > mPromo) {
                mPromo = d;
                mPromoName = offer.name;
              }
            }
          }

          const mTotal = mRecurring + mPromo;
          if (mTotal > 0 || machineCategoryFloor.total > 0) {
            machineDiscounts[m.id] = {
              recurring: mRecurring,
              promo: mPromo,
              promoName: mPromoName,
              total: mTotal,
            };
          }
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
          // Per-pitch free pool. The client uses this when the user has
          // picked a specific pitch to gate the slot: ASTRO eats indoor
          // net capacity, NATURAL eats outdoor turf-wicket capacity,
          // CEMENT eats cement-wicket capacity. Each pool is independent.
          freeByPitch: {
            ASTRO: availability.freeByPitch.ASTRO.map((r) => ({ id: r.id, name: r.name, type: r.type })),
            CEMENT: availability.freeByPitch.CEMENT.map((r) => ({ id: r.id, name: r.name, type: r.type })),
            NATURAL: availability.freeByPitch.NATURAL.map((r) => ({ id: r.id, name: r.name, type: r.type })),
          },
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
        // Per-pitch blocks for granular UI control
        blockedByPitch: Object.fromEntries(
          Object.entries(blockedByPitch).map(([p, data]) => [
            p,
            {
              categories: Array.from(data.categories),
              machineRowIds: Array.from(data.machineRowIds),
            },
          ]),
        ),
          // Operator availability — only meaningful for MACHINE category.
          operatorCount,
          operatorsBusy: busyOperators,
          operatorAvailable,
          selfOperate,
          // Machine rows already booked at this slot. The client uses
          // this to grey out the slot when the user's *selected*
          // machine is taken — without it, the picker might show "Open"
          // for a slot the server would 409 on submit because another
          // booking already claimed that specific machine.
          busyMachineIds: Array.from(busyMachineIds),
          // Recurring + promo discounts by category. Empty when no rule
          // matches; client treats missing entries as 0 discount.
          discountsByCategory,
          // Per-machine MACHINE-category discount preview. When the
          // user has picked a specific machine the client should prefer
          // this entry over discountsByCategory.MACHINE so machine-row
          // pinned offers reflect in the slot card. Empty when no
          // offer / recurring rule matches any machine here.
          machineDiscounts,
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
      coachingPitchTypes,
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
