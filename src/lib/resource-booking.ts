/**
 * Resource-based booking engine — Toplay and any future center using
 * `Center.bookingModel = RESOURCE_BASED`.
 *
 * ### Mental model
 *
 * A center has Resources (nets, courts, turf wickets) and can have
 * Coaches and Sidearm staff (Users with COACH / SIDEARM_SPECIALIST
 * memberships). Each Booking falls under one of:
 *
 *   - MACHINE         — consumes 1 net + 1 Machine instance
 *   - SIDEARM         — consumes 1 net + 1 SIDEARM_SPECIALIST user
 *   - COACHING        — consumes 1 net + 1 COACH user
 *   - FULL_COURT      — consumes ALL active indoor nets
 *   - CORPORATE_BATCH — consumes the configured number of nets, admin only
 *
 * Availability for a given time window = "all required resources free".
 *
 * ### Corporate batch
 *
 * Configured via the `CORPORATE_BATCH_CONFIG` policy (per-center override
 * recommended). Default JSON shape:
 *
 *   {
 *     "enabled": true,
 *     "days": [1, 2, 3, 4, 5],          // Mon-Fri (0=Sun..6=Sat, IST)
 *     "startTime": "07:30",             // HH:MM IST
 *     "endTime":   "09:30",
 *     "netsConsumed": 2
 *   }
 *
 * During the corporate batch window, the engine subtracts `netsConsumed`
 * from the indoor-net pool — so users can still book the remaining nets,
 * but the batch always claims its slice. We don't insert real Booking
 * rows for the batch; we simply reserve capacity at availability-check
 * time. Admins can override this by deleting/disabling the policy.
 */

import { prisma } from '@/lib/prisma';
import { getCenterOnlyPolicyJson } from '@/lib/policy';
import type {
  BookingCategory,
  BookingStatus,
  ResourceCategory,
  ResourceType,
} from '@prisma/client';

// ─── Types ───────────────────────────────────────────────────────────

export interface ResourceLite {
  id: string;
  name: string;
  type: ResourceType;
  category: ResourceCategory;
  capacity: number;
  isActive: boolean;
  displayOrder: number;
}

export interface BookableSlotWindow {
  date: Date;       // day at 00:00 IST (DB-stored UTC midnight of IST day)
  startTime: Date;  // exact slot start
  endTime: Date;    // exact slot end
}

export interface CorporateBatchConfig {
  enabled: boolean;
  days: number[];          // IST day-of-week 0..6 (0 = Sunday)
  startTime: string;       // "HH:MM" IST
  endTime: string;         // "HH:MM" IST
  netsConsumed: number;    // how many indoor nets the batch holds
}

// Off by default — a corporate-batch reservation is a center-specific
// arrangement, not a platform-wide policy. Centers that want it must
// set `CORPORATE_BATCH_CONFIG` in CenterPolicy with `enabled: true` plus
// their own window/nets. Leaving the default off means a brand-new
// center won't have phantom blocks Mon–Fri mornings just because it
// hasn't configured anything yet.
export const DEFAULT_CORPORATE_BATCH_CONFIG: CorporateBatchConfig = {
  enabled: false,
  days: [1, 2, 3, 4, 5],
  startTime: '07:30',
  endTime: '09:30',
  netsConsumed: 2,
};

// ─── Time helpers (IST) ──────────────────────────────────────────────

function getISTHHMM(d: Date): string {
  const istMs = d.getTime() + (5 * 60 + 30) * 60 * 1000;
  const ist = new Date(istMs);
  return `${ist.getUTCHours().toString().padStart(2, '0')}:${ist
    .getUTCMinutes()
    .toString()
    .padStart(2, '0')}`;
}

function getISTDayOfWeek(d: Date): number {
  const istMs = d.getTime() + (5 * 60 + 30) * 60 * 1000;
  return new Date(istMs).getUTCDay();
}

/** True if [aStart, aEnd) overlaps [bStart, bEnd). */
function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

// ─── Center config ───────────────────────────────────────────────────

export async function getCorporateBatchConfig(centerId: string): Promise<CorporateBatchConfig> {
  // RESOURCE_BASED centers ignore the global Policy table — the corporate
  // batch reservation is purely a center-level arrangement.
  return getCenterOnlyPolicyJson(
    'CORPORATE_BATCH_CONFIG',
    centerId,
    DEFAULT_CORPORATE_BATCH_CONFIG,
  );
}

/**
 * How many indoor nets are claimed by the corporate batch during the
 * given slot window? Returns 0 outside the configured window.
 */
export async function getCorporateBatchNetsForSlot(
  centerId: string,
  slot: BookableSlotWindow,
): Promise<number> {
  const config = await getCorporateBatchConfig(centerId);
  if (!config.enabled || config.netsConsumed <= 0) return 0;

  const dow = getISTDayOfWeek(slot.startTime);
  if (config.days.length > 0 && !config.days.includes(dow)) return 0;

  const slotStart = getISTHHMM(slot.startTime);
  const slotEnd = getISTHHMM(slot.endTime);
  // Treat as overlapping if any minute of the slot is inside the window.
  if (slotEnd <= config.startTime) return 0;
  if (slotStart >= config.endTime) return 0;
  return config.netsConsumed;
}

// ─── Resource & staff lookups ────────────────────────────────────────

export async function getCenterResources(centerId: string): Promise<ResourceLite[]> {
  const rows = await prisma.resource.findMany({
    where: { centerId, isActive: true },
    orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      type: true,
      category: true,
      capacity: true,
      isActive: true,
      displayOrder: true,
    },
  });
  return rows;
}

/** A single weekly recurring availability window for a coach/specialist. */
export interface AvailabilityWindow {
  dayOfWeek: number; // 0=Sun..6=Sat (IST)
  startTime: string; // HH:MM IST
  endTime: string;   // HH:MM IST
}

interface CenterMembershipUserRow {
  userId: string;
  metadata: unknown;
  user: { id: string; name: string | null; mobileNumber: string | null; email: string | null };
  /** Empty array = no schedule constraint (treated as always available). */
  availability: AvailabilityWindow[];
}

/**
 * True if the slot falls inside the user's weekly availability schedule.
 * An empty schedule is treated as "always available" — that's the
 * legacy behaviour for coaches/specialists with no rows yet.
 */
export function slotMatchesAvailability(
  slot: BookableSlotWindow,
  windows: AvailabilityWindow[],
): boolean {
  if (!windows || windows.length === 0) return true;
  const dow = getISTDayOfWeek(slot.startTime);
  const dayWindows = windows.filter((w) => w.dayOfWeek === dow);
  if (dayWindows.length === 0) return false;
  const slotStart = getISTHHMM(slot.startTime);
  const slotEnd = getISTHHMM(slot.endTime);
  // Slot must fit entirely inside at least one window.
  return dayWindows.some((w) => slotStart >= w.startTime && slotEnd <= w.endTime);
}

export async function getCenterCoaches(centerId: string): Promise<CenterMembershipUserRow[]> {
  return prisma.centerMembership.findMany({
    where: { centerId, role: 'COACH', isActive: true },
    select: {
      userId: true,
      metadata: true,
      availability: {
        where: { isActive: true },
        select: { dayOfWeek: true, startTime: true, endTime: true },
      },
      user: { select: { id: true, name: true, mobileNumber: true, email: true } },
    },
  });
}

export async function getCenterStaff(centerId: string): Promise<CenterMembershipUserRow[]> {
  return prisma.centerMembership.findMany({
    where: { centerId, role: 'SIDEARM_SPECIALIST', isActive: true },
    select: {
      userId: true,
      metadata: true,
      availability: {
        where: { isActive: true },
        select: { dayOfWeek: true, startTime: true, endTime: true },
      },
      user: { select: { id: true, name: true, mobileNumber: true, email: true } },
    },
  });
}

// ─── Per-slot occupancy ──────────────────────────────────────────────

interface OccupancySnapshot {
  /** Resource IDs claimed by an active booking overlapping the slot. */
  claimedResourceIds: Set<string>;
  /** User IDs of coaches busy at the slot. */
  busyCoachIds: Set<string>;
  /** User IDs of sidearm staff busy at the slot. */
  busyStaffIds: Set<string>;
  /** Machine IDs busy at the slot. */
  busyMachineIds: Set<string>;
}

/**
 * Compute who/what is busy at the given slot window. Cancelled bookings
 * are ignored. Status DONE is treated as busy because it implies the slot
 * was used (overlap between a new booking and a DONE booking on the same
 * date+time would be a logical conflict).
 */
export async function getOccupancyForSlot(
  centerId: string,
  slot: BookableSlotWindow,
  // Optional tx client. When inside a Serializable transaction, the
  // caller MUST pass tx so the SELECT participates in the tx's read
  // set — otherwise PostgreSQL can't detect serialization conflicts
  // between two concurrent submits, both reads see an empty
  // `busyMachineIds`, and both end up inserting a Booking for the
  // same machine/time (the bug that caused 4 rows where the user
  // expected 2). The legacy 2-arg signature still works for read-only
  // callers (availability endpoint).
  tx?: { booking: { findMany: typeof prisma.booking.findMany } },
): Promise<OccupancySnapshot> {
  const client = tx ?? prisma;
  // We pull only the columns we need. Prisma's date filter is exact-day
  // (Booking.date is @db.Date), and startTime/endTime are full timestamps.
  const bookings = await client.booking.findMany({
    where: {
      centerId,
      date: slot.date,
      // Active bookings — anything not cancelled.
      status: { not: 'CANCELLED' },
    },
    select: {
      id: true,
      startTime: true,
      endTime: true,
      assignedMachineId: true,
      assignedCoachId: true,
      assignedStaffId: true,
      resourceAssignments: { select: { resourceId: true } },
    },
  });

  const claimedResourceIds = new Set<string>();
  const busyCoachIds = new Set<string>();
  const busyStaffIds = new Set<string>();
  const busyMachineIds = new Set<string>();

  for (const b of bookings) {
    if (!overlaps(b.startTime, b.endTime, slot.startTime, slot.endTime)) continue;
    for (const ra of b.resourceAssignments) claimedResourceIds.add(ra.resourceId);
    if (b.assignedCoachId) busyCoachIds.add(b.assignedCoachId);
    if (b.assignedStaffId) busyStaffIds.add(b.assignedStaffId);
    if (b.assignedMachineId) busyMachineIds.add(b.assignedMachineId);
  }

  return { claimedResourceIds, busyCoachIds, busyStaffIds, busyMachineIds };
}

// ─── Availability summary ────────────────────────────────────────────

export interface SlotAvailability {
  /** All indoor nets currently free (excludes corporate-batch reservation). */
  freeIndoorNets: ResourceLite[];
  /** All outdoor turf/cement wickets currently free. */
  freeOutdoorResources: ResourceLite[];
  /** Coaches free at this slot. */
  freeCoaches: CenterMembershipUserRow[];
  /** Sidearm staff free at this slot. */
  freeSidearmStaff: CenterMembershipUserRow[];
  /** Whether a FULL_COURT booking is achievable (every indoor net free + corporate batch not active). */
  fullCourtAvailable: boolean;
  /** How many indoor nets the corporate batch is holding right now. */
  corporateBatchNetsHeld: number;
}

/**
 * One-shot availability for a single slot window. The grid endpoint
 * (phase 5.5) calls this per slot but reuses pre-fetched lists so we
 * don't re-query Resources/Coaches/Staff per slot.
 */
export async function getSlotAvailability(
  centerId: string,
  slot: BookableSlotWindow,
): Promise<SlotAvailability> {
  const [resources, coaches, staff, occupancy, batchNets] = await Promise.all([
    getCenterResources(centerId),
    getCenterCoaches(centerId),
    getCenterStaff(centerId),
    getOccupancyForSlot(centerId, slot),
    getCorporateBatchNetsForSlot(centerId, slot),
  ]);

  return computeSlotAvailability({ resources, coaches, staff, occupancy, batchNets, slot });
}

interface AvailabilityInputs {
  resources: ResourceLite[];
  coaches: CenterMembershipUserRow[];
  staff: CenterMembershipUserRow[];
  occupancy: OccupancySnapshot;
  batchNets: number;
  /** When provided, additionally filter coaches/staff by their weekly
   *  availability schedule. Omit (or pass `null`) to skip the filter —
   *  primarily for callers that don't have a slot context. */
  slot?: BookableSlotWindow | null;
}

export function computeSlotAvailability(inputs: AvailabilityInputs): SlotAvailability {
  const { resources, coaches, staff, occupancy, batchNets, slot } = inputs;

  const indoorNets = resources.filter(
    (r) => r.category === 'INDOOR' && r.type === 'NET',
  );
  const outdoor = resources.filter((r) => r.category === 'OUTDOOR');

  const freeIndoor = indoorNets.filter((r) => !occupancy.claimedResourceIds.has(r.id));
  const freeOutdoor = outdoor.filter((r) => !occupancy.claimedResourceIds.has(r.id));

  // Subtract corporate-batch reservation from the available indoor pool.
  // We virtually claim the LAST indoor nets (highest displayOrder) so the
  // user-facing list still presents nets 1, 2, … as preferred.
  const heldByBatch = Math.min(batchNets, freeIndoor.length);
  const freeIndoorAfterBatch = freeIndoor.slice(0, freeIndoor.length - heldByBatch);

  // Filter out coaches/staff whose schedule doesn't cover this slot, then
  // remove anyone already booked into another session at this time.
  // No `slot` provided ⇒ skip the schedule filter entirely.
  const scheduledCoaches = slot
    ? coaches.filter((c) => slotMatchesAvailability(slot, c.availability))
    : coaches;
  const scheduledStaff = slot
    ? staff.filter((s) => slotMatchesAvailability(slot, s.availability))
    : staff;

  const freeCoaches = scheduledCoaches.filter((c) => !occupancy.busyCoachIds.has(c.userId));
  const freeStaff = scheduledStaff.filter((s) => !occupancy.busyStaffIds.has(s.userId));

  // Full court requires every active indoor net to be unclaimed AND the
  // corporate batch to not be active.
  const fullCourtAvailable =
    indoorNets.length > 0 &&
    freeIndoor.length === indoorNets.length &&
    heldByBatch === 0;

  return {
    freeIndoorNets: freeIndoorAfterBatch,
    freeOutdoorResources: freeOutdoor,
    freeCoaches,
    freeSidearmStaff: freeStaff,
    fullCourtAvailable,
    corporateBatchNetsHeld: heldByBatch,
  };
}

// ─── Blocked-slot evaluation ─────────────────────────────────────────
//
// BlockedSlot rows can target resource-based bookings via three new
// arrays (in addition to the legacy ABCA-shaped ones):
//
//   - machineRowIds — if non-empty, block applies only to bookings
//                     using one of those Machine rows.
//   - resourceIds   — if non-empty, block applies only to bookings
//                     consuming at least one of those resources.
//   - categories    — if non-empty, block applies only to those
//                     BookingCategory values.
//
// A row whose new arrays are all empty AND whose legacy enum/string
// fields are also unset is a CATCHALL block — every booking in the
// time window is blocked. Mixed axes intersect (logical AND).

export interface ActiveBlock {
  id: string;
  reason: string | null;
  appliesTo: string;
  machineRowIds: string[];
  resourceIds: string[];
  categories: BookingCategory[];
  /** Surface enough legacy info that a future ABCA caller could use the
   *  same helper. RESOURCE_BASED callers ignore these. */
  legacyMachineId: string | null;
  legacyMachineIds: string[];
  legacyMachineType: string | null;
  legacyPitchType: string | null;
}

/**
 * Return every BlockedSlot at this center whose schedule overlaps the
 * given slot window. Targeting axes (machineRowIds, resourceIds,
 * categories, appliesTo) are intentionally NOT applied here — callers
 * decide how to interpret them per the booking they're evaluating.
 */
/** Raw row shape returned by getDayCandidateBlocks. Internal type used
 *  to share the prefetched list with the synchronous per-slot filter. */
type CandidateBlock = Awaited<ReturnType<typeof getDayCandidateBlocks>>[number];

/**
 * Fetch every block whose date-range covers `date` at this center.
 * Caller-side filtering (per-slot time/dow/audience) happens via
 * `filterBlocksForSlotSync`. This split removes an N+1 against
 * BlockedSlot on the resource-availability hot path — previously the
 * route called `getActiveBlocksForSlot` per slot, each round-tripping
 * to the DB with the same date filter.
 */
export async function getDayCandidateBlocks(centerId: string, date: Date) {
  return prisma.blockedSlot.findMany({
    where: {
      centerId,
      startDate: { lte: date },
      endDate: { gte: date },
    },
    select: {
      id: true,
      startTime: true,
      endTime: true,
      recurringDays: true,
      reason: true,
      appliesTo: true,
      machineRowIds: true,
      resourceIds: true,
      categories: true,
      machineId: true,
      machineIds: true,
      machineType: true,
      pitchType: true,
    },
  });
}

/** Apply the per-slot filters (day-of-week + time overlap) to a prefetched
 *  candidate list. Pure JS, no DB. Returns the ActiveBlocks affecting the
 *  given window — same shape `applyBlocksToAvailability` expects. */
export function filterBlocksForSlotSync(
  candidates: CandidateBlock[],
  slot: BookableSlotWindow,
): ActiveBlock[] {
  const dow = getISTDayOfWeek(slot.startTime);
  const slotStartHHMM = getISTHHMM(slot.startTime);
  const slotEndHHMM = getISTHHMM(slot.endTime);

  const matching: ActiveBlock[] = [];
  for (const b of candidates) {
    if (b.recurringDays && b.recurringDays.length > 0 && !b.recurringDays.includes(dow)) {
      continue;
    }
    if (b.startTime && b.endTime) {
      const blockStartHHMM = getISTHHMM(b.startTime);
      const blockEndHHMM = getISTHHMM(b.endTime);
      if (slotEndHHMM <= blockStartHHMM || slotStartHHMM >= blockEndHHMM) continue;
    }
    matching.push({
      id: b.id,
      reason: b.reason,
      appliesTo: b.appliesTo,
      machineRowIds: b.machineRowIds ?? [],
      resourceIds: b.resourceIds ?? [],
      categories: (b.categories ?? []) as BookingCategory[],
      legacyMachineId: b.machineId ?? null,
      legacyMachineIds: b.machineIds ?? [],
      legacyMachineType: b.machineType ?? null,
      legacyPitchType: b.pitchType ?? null,
    });
  }
  return matching;
}

/**
 * Backwards-compatible wrapper. Existing callers (book-resource,
 * resource-pricing tests) keep working; the new resource-availability
 * hot path goes through `getDayCandidateBlocks` + `filterBlocksForSlotSync`
 * to avoid an N+1 of the same DB filter.
 */
export async function getActiveBlocksForSlot(
  centerId: string,
  slot: BookableSlotWindow,
): Promise<ActiveBlock[]> {
  const candidates = await getDayCandidateBlocks(centerId, slot.date);
  return filterBlocksForSlotSync(candidates, slot);
}

/**
 * Subtract blocked machines/resources from an availability snapshot in
 * place — used by the slot-grid endpoint so blocked items are hidden
 * from the user picker. Categories are returned separately so the
 * caller can mark whole tabs as unavailable.
 */
export function applyBlocksToAvailability(
  availability: SlotAvailability,
  blocks: ActiveBlock[],
  audience: 'ALL' | 'SPECIAL' | 'NON_SPECIAL' = 'ALL',
): { availability: SlotAvailability; blockedCategories: Set<BookingCategory>; blockedMachineRowIds: Set<string> } {
  const blockedCategories = new Set<BookingCategory>();
  const blockedMachineRowIds = new Set<string>();
  const blockedResourceIds = new Set<string>();

  for (const b of blocks) {
    if (!appliesToAudience(b.appliesTo, audience)) continue;
    for (const c of b.categories) blockedCategories.add(c);
    for (const id of b.machineRowIds) blockedMachineRowIds.add(id);
    for (const id of b.resourceIds) blockedResourceIds.add(id);

    // CATCHALL — neither category, machineRow, nor resource targeted +
    // no legacy axes either → block every category.
    const hasAnyAxis =
      b.categories.length +
        b.machineRowIds.length +
        b.resourceIds.length +
        b.legacyMachineIds.length +
        (b.legacyMachineId ? 1 : 0) +
        (b.legacyMachineType ? 1 : 0) +
        (b.legacyPitchType ? 1 : 0) >
      0;
    if (!hasAnyAxis) {
      // Block every booking-category we know about. The frontend uses
      // this to grey out every tab in the slot picker.
      for (const c of ['MACHINE', 'SIDEARM', 'COACHING', 'NET', 'FULL_COURT', 'CORPORATE_BATCH'] as BookingCategory[]) {
        blockedCategories.add(c);
      }
    }
  }

  const filteredAvailability: SlotAvailability = {
    ...availability,
    freeIndoorNets: availability.freeIndoorNets.filter((r) => !blockedResourceIds.has(r.id)),
    freeOutdoorResources: availability.freeOutdoorResources.filter((r) => !blockedResourceIds.has(r.id)),
  };
  return { availability: filteredAvailability, blockedCategories, blockedMachineRowIds };
}

/**
 * True if the active block's `appliesTo` matches the audience the
 * caller is evaluating. The user-app slot grid passes `ALL` (everyone
 * sees the same grid); booking validation passes the booking user's
 * special/non-special flag.
 */
function appliesToAudience(blockAppliesTo: string, audience: 'ALL' | 'SPECIAL' | 'NON_SPECIAL'): boolean {
  if (blockAppliesTo === 'ALL') return true;
  if (audience === 'ALL') return true; // grid-level eval shows worst case
  return blockAppliesTo === audience;
}

/**
 * Decide whether a planned RESOURCE_BASED booking is blocked. Returns
 * the block reason (string) when blocked, or null when clear.
 */
export function evaluateBlockForBooking(
  blocks: ActiveBlock[],
  booking: {
    category: BookingCategory;
    machineRowId?: string | null;
    resourceIds: string[];
  },
  audience: 'ALL' | 'SPECIAL' | 'NON_SPECIAL' = 'ALL',
): string | null {
  for (const b of blocks) {
    if (!appliesToAudience(b.appliesTo, audience)) continue;

    // Determine if this block matches this booking. A block matches if
    // EVERY non-empty axis it specifies matches the booking.
    let axisCount = 0;
    let axisMatched = 0;

    if (b.categories.length > 0) {
      axisCount++;
      if (b.categories.includes(booking.category)) axisMatched++;
    }
    if (b.machineRowIds.length > 0) {
      axisCount++;
      if (booking.machineRowId && b.machineRowIds.includes(booking.machineRowId)) axisMatched++;
    }
    if (b.resourceIds.length > 0) {
      axisCount++;
      if (booking.resourceIds.some((id) => b.resourceIds.includes(id))) axisMatched++;
    }

    if (axisCount === 0) {
      // Catchall block (no resource-based axes set) — only honor it if
      // legacy axes are also empty, matching the all-day rule.
      const legacyAxes =
        b.legacyMachineIds.length +
        (b.legacyMachineId ? 1 : 0) +
        (b.legacyMachineType ? 1 : 0) +
        (b.legacyPitchType ? 1 : 0);
      if (legacyAxes === 0) {
        return formatBlockReason(b.reason, 'This slot is currently blocked');
      }
      continue;
    }

    if (axisMatched === axisCount) {
      return formatBlockReason(b.reason, 'This booking is blocked by an admin policy');
    }
  }
  return null;
}

/**
 * Wrap an admin-provided block reason so it always reads as a sentence
 * to the user. Empty / very short reasons (e.g. "X" left over from a
 * test) get folded into the default; longer reasons are prefixed with
 * "Slot blocked: " so the user has context for what they're seeing,
 * even when the admin's reason is fine on its own.
 */
function formatBlockReason(reason: string | null | undefined, fallback: string): string {
  const trimmed = (reason ?? '').trim();
  if (trimmed.length < 5) return fallback;
  return `Slot blocked: ${trimmed}`;
}

// ─── Validation for booking creation ─────────────────────────────────

export interface BookingPlan {
  category: BookingCategory;
  centerId: string;
  startTime: Date;
  endTime: Date;
  date: Date;
  // Caller-provided choices (optional; engine fills in if blank):
  resourceIds?: string[];
  machineId?: string | null;
  coachId?: string | null;
  staffId?: string | null;
  /** For CORPORATE_BATCH only: how many nets to take. Overrides the policy. */
  corporateNets?: number;
}

export interface PlannedAssignment {
  category: BookingCategory;
  resourceIds: string[];
  machineId: string | null;
  coachId: string | null;
  staffId: string | null;
}

/**
 * Validate that the requested booking can be fulfilled, picking real
 * Resources/Coach/Staff if the caller didn't pre-pick. Throws a
 * `BookingResourceError` on conflict.
 */
export class BookingResourceError extends Error {
  status: number;
  constructor(message: string, status = 409) {
    super(message);
    this.name = 'BookingResourceError';
    this.status = status;
  }
}

export async function planBooking(
  plan: BookingPlan,
  context: {
    audience?: 'ALL' | 'SPECIAL' | 'NON_SPECIAL';
    // Optional tx client. When passed, the per-slot occupancy read
    // uses the tx connection so PostgreSQL Serializable can detect
    // conflicts between two concurrent booking transactions. Without
    // this, a double-click on the Confirm button (or two parallel
    // POSTs) could both pass the busyMachineIds check and both
    // insert a Booking for the same machine + time, producing the
    // observed "expected 2, got 4" duplicate rows.
    tx?: { booking: { findMany: typeof prisma.booking.findMany } };
  } = {},
): Promise<PlannedAssignment> {
  const slot: BookableSlotWindow = {
    date: plan.date,
    startTime: plan.startTime,
    endTime: plan.endTime,
  };
  const [resources, coaches, staff, occupancy, batchNets, blocks] = await Promise.all([
    getCenterResources(plan.centerId),
    getCenterCoaches(plan.centerId),
    getCenterStaff(plan.centerId),
    getOccupancyForSlot(plan.centerId, slot, context.tx),
    getCorporateBatchNetsForSlot(plan.centerId, slot),
    getActiveBlocksForSlot(plan.centerId, slot),
  ]);
  const availability = computeSlotAvailability({ resources, coaches, staff, occupancy, batchNets, slot });

  // Pre-flight category-level block check. Refuses early when an
  // entire category is blocked at this slot — the resource-specific
  // checks downstream catch the more granular cases.
  const audience = context.audience ?? 'ALL';
  const categoryBlock = evaluateBlockForBooking(
    blocks,
    { category: plan.category, machineRowId: plan.machineId ?? null, resourceIds: plan.resourceIds ?? [] },
    audience,
  );
  if (categoryBlock) {
    throw new BookingResourceError(categoryBlock, 409);
  }

  // Resolve a specific resource by ID, ensuring it's free + at this center.
  const isFree = (resourceId: string) => !occupancy.claimedResourceIds.has(resourceId);
  const findResource = (id: string) => resources.find((r) => r.id === id);

  // For all categories, ensure the requested resources (if any) are real and free.
  const requested = plan.resourceIds ?? [];
  for (const id of requested) {
    const r = findResource(id);
    if (!r) throw new BookingResourceError(`Resource ${id} not found at this center`, 400);
    if (!isFree(id)) throw new BookingResourceError(`Resource "${r.name}" is already booked`, 409);
  }

  // Per-category resolution. Inner helper so we can post-check the
  // resolved (machine, resource[]) tuple against blocks once we know
  // exactly what's being claimed.
  const resolved = await (async (): Promise<PlannedAssignment> => {
  switch (plan.category) {
    case 'MACHINE': {
      // Machine occupancy gate. Without this, two bookings for the
      // same Machine row at overlapping times could both succeed —
      // the UI hides the busy machine but a direct POST or a race
      // between two carts would slip past. We already prefetched
      // `occupancy.busyMachineIds` from the day's bookings; reuse it.
      if (plan.machineId && occupancy.busyMachineIds.has(plan.machineId)) {
        throw new BookingResourceError(
          'This machine is already booked at this slot',
          409,
        );
      }
      const net = await pickNetFor({
        plan,
        availability,
        resources,
        occupancy,
        machineId: plan.machineId ?? null,
      });
      return {
        category: 'MACHINE',
        resourceIds: [net.id],
        machineId: plan.machineId ?? null,
        coachId: null,
        staffId: null,
      };
    }
    case 'SIDEARM': {
      if (availability.freeSidearmStaff.length === 0) {
        throw new BookingResourceError('No sidearm staff available for this slot', 409);
      }
      // Caller may pin a specific staff member; otherwise pick the first free.
      const chosenStaff =
        plan.staffId
          ? availability.freeSidearmStaff.find((s) => s.userId === plan.staffId)
          : availability.freeSidearmStaff[0];
      if (!chosenStaff) {
        throw new BookingResourceError('Selected staff is not available', 409);
      }
      const net = await pickNetFor({ plan, availability, resources, occupancy });
      return {
        category: 'SIDEARM',
        resourceIds: [net.id],
        machineId: null,
        coachId: null,
        staffId: chosenStaff.userId,
      };
    }
    case 'COACHING': {
      if (availability.freeCoaches.length === 0) {
        throw new BookingResourceError('No coaches available for this slot', 409);
      }
      const chosenCoach =
        plan.coachId
          ? availability.freeCoaches.find((c) => c.userId === plan.coachId)
          : availability.freeCoaches[0];
      if (!chosenCoach) {
        throw new BookingResourceError('Selected coach is not available', 409);
      }
      const net = await pickNetFor({ plan, availability, resources, occupancy });
      return {
        category: 'COACHING',
        resourceIds: [net.id],
        machineId: null,
        coachId: chosenCoach.userId,
        staffId: null,
      };
    }
    case 'FULL_COURT': {
      if (!availability.fullCourtAvailable) {
        throw new BookingResourceError(
          availability.corporateBatchNetsHeld > 0
            ? 'Full court is unavailable during the corporate batch window'
            : 'Full court requires every indoor net to be free',
          409,
        );
      }
      const indoorNets = resources.filter((r) => r.category === 'INDOOR' && r.type === 'NET');
      return {
        category: 'FULL_COURT',
        resourceIds: indoorNets.map((r) => r.id),
        machineId: null,
        coachId: null,
        staffId: null,
      };
    }
    case 'CORPORATE_BATCH': {
      // Two paths:
      //  - Caller pre-supplied resourceIds → use them (admin override).
      //  - Otherwise → auto-claim the configured number of indoor nets,
      //    matching the policy-driven virtual reservation. This lets
      //    end users book a "small group" session without picking nets.
      if (plan.resourceIds && plan.resourceIds.length > 0) {
        return {
          category: 'CORPORATE_BATCH',
          resourceIds: plan.resourceIds,
          machineId: null,
          coachId: null,
          staffId: null,
        };
      }
      const config = await getCorporateBatchConfig(plan.centerId);
      const nets = Math.max(1, plan.corporateNets ?? config.netsConsumed);
      const indoorFree = availability.freeIndoorNets;
      if (indoorFree.length < nets) {
        throw new BookingResourceError(
          `Corporate batch needs ${nets} indoor nets but only ${indoorFree.length} are free`,
          409,
        );
      }
      return {
        category: 'CORPORATE_BATCH',
        resourceIds: indoorFree.slice(0, nets).map((r) => r.id),
        machineId: null,
        coachId: null,
        staffId: null,
      };
    }
    case 'NET': {
      // Bare-net booking: 1 net, nothing else. Pitch type is captured
      // on Booking.pitchType but doesn't influence resource selection
      // here — the engine only cares that *some* net is free.
      const net = await pickNetFor({ plan, availability, resources, occupancy });
      return {
        category: 'NET',
        resourceIds: [net.id],
        machineId: null,
        coachId: null,
        staffId: null,
      };
    }
  }
  })();

  // Final block check with the resolved machine + resources. Catches
  // resource- or machine-row-level blocks that the pre-flight (which
  // only knew the category) couldn't.
  const postBlock = evaluateBlockForBooking(
    blocks,
    {
      category: resolved.category,
      machineRowId: resolved.machineId,
      resourceIds: resolved.resourceIds,
    },
    audience,
  );
  if (postBlock) {
    throw new BookingResourceError(postBlock, 409);
  }
  return resolved;
}

interface PickNetArgs {
  plan: BookingPlan;
  availability: SlotAvailability;
  resources: ResourceLite[];
  occupancy: OccupancySnapshot;
  /** If a specific machine is being assigned, prefer its home net (if free). */
  machineId?: string | null;
}

async function pickNetFor({
  plan,
  availability,
  resources,
  occupancy,
  machineId,
}: PickNetArgs): Promise<ResourceLite> {
  // Caller-pinned resource wins.
  if (plan.resourceIds && plan.resourceIds.length > 0) {
    const id = plan.resourceIds[0];
    const r = resources.find((x) => x.id === id);
    if (!r || occupancy.claimedResourceIds.has(id)) {
      throw new BookingResourceError(
        r ? `Resource "${r.name}" is already booked` : 'Resource not found',
        r ? 409 : 400,
      );
    }
    return r;
  }

  // Prefer the machine's home net if set + free.
  if (machineId) {
    const machine = await prisma.machine.findUnique({
      where: { id: machineId },
      select: { resourceId: true, centerId: true },
    });
    if (!machine || machine.centerId !== plan.centerId) {
      throw new BookingResourceError('Machine not found at this center', 400);
    }
    if (machine.resourceId) {
      const home = resources.find((r) => r.id === machine.resourceId);
      if (home && !occupancy.claimedResourceIds.has(home.id)) {
        return home;
      }
    }
  }

  // Otherwise pick the first available indoor net.
  const candidate = availability.freeIndoorNets[0];
  if (!candidate) {
    throw new BookingResourceError(
      availability.corporateBatchNetsHeld > 0
        ? 'No nets free — corporate batch is holding the indoor pool'
        : 'No nets available for this slot',
      409,
    );
  }
  return candidate;
}

// ─── Persisting resource assignments after booking creation ──────────

/**
 * Insert the BookingResourceAssignment rows for a booking. Use inside a
 * Prisma transaction so creation + assignment are atomic.
 */
export async function persistResourceAssignments(
  tx: Pick<typeof prisma, 'bookingResourceAssignment'>,
  bookingId: string,
  resourceIds: string[],
): Promise<void> {
  if (resourceIds.length === 0) return;
  await tx.bookingResourceAssignment.createMany({
    data: resourceIds.map((resourceId) => ({ bookingId, resourceId })),
    skipDuplicates: true,
  });
}

// ─── Type-only re-exports so callers don't need to import from prisma/client ──
export type { BookingCategory, BookingStatus };
