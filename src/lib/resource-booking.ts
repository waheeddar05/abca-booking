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
  PitchType,
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

/** The three pitch types a center can hold wickets for. Mirrors the
 *  bookable pitch universe (the legacy `TURF` enum value is never held). */
export type HeldPitch = 'ASTRO' | 'CEMENT' | 'NATURAL';
export const HELD_PITCHES: HeldPitch[] = ['ASTRO', 'CEMENT', 'NATURAL'];

/** How many wickets of each pitch type a reservation holds. Absent /
 *  zero entries hold nothing for that pitch. */
export type WicketsHeld = Partial<Record<HeldPitch, number>>;

export interface CorporateBatchConfig {
  enabled: boolean;
  days: number[];          // IST day-of-week 0..6 (0 = Sunday)
  startTime: string;       // "HH:MM" IST
  endTime: string;         // "HH:MM" IST
  netsConsumed: number;    // legacy: flat count of indoor (Astro) nets held
  // Per-pitch wickets held during the window. When present it is the
  // source of truth (fully dynamic across configured pitch types); when
  // absent the legacy `netsConsumed` count is folded into the Astro pool.
  wicketsHeld?: WicketsHeld;
}

/** Minimal per-slot reservation shape shared by the corporate batch and
 *  each match-simulation session. */
export interface PitchReservationWindow {
  enabled: boolean;
  days: number[];
  startTime: string;
  endTime: string;
  wicketsHeld?: WicketsHeld;
  netsConsumed?: number;
}

/**
 * Normalise a reservation's wickets to an explicit per-pitch count.
 * Prefers `wicketsHeld`; when that holds nothing, folds the legacy
 * `netsConsumed` flat count into the Astro pool so old configs keep
 * behaving exactly as before.
 */
export function resolveWicketsHeld(
  window: { wicketsHeld?: WicketsHeld; netsConsumed?: number },
): Record<HeldPitch, number> {
  const w = window.wicketsHeld ?? {};
  const astro = Math.max(0, Math.floor(w.ASTRO ?? 0));
  const cement = Math.max(0, Math.floor(w.CEMENT ?? 0));
  const natural = Math.max(0, Math.floor(w.NATURAL ?? 0));
  if (astro + cement + natural > 0) {
    return { ASTRO: astro, CEMENT: cement, NATURAL: natural };
  }
  return { ASTRO: Math.max(0, Math.floor(window.netsConsumed ?? 0)), CEMENT: 0, NATURAL: 0 };
}

// Off by default — a corporate-batch reservation is a center-specific
// arrangement, not a platform-wide policy. Centers that want it must
// set `CORPORATE_BATCH_CONFIG` in CenterPolicy with `enabled: true` plus
// their own window/nets. Leaving the default off means a brand-new
// center won't have phantom blocks just because it hasn't configured
// anything yet.
//
// NOTE: the same policy key also carries the Match Practice enrollment
// knobs (coach, fees, capacity, half-month) — see
// `src/lib/match-practice.ts → getCorporateBatchSettings`, which merges
// the full shape. This engine only consumes the net-hold subset below;
// keep the two defaults' shared fields (days/times/nets) in sync.
export const DEFAULT_CORPORATE_BATCH_CONFIG: CorporateBatchConfig = {
  enabled: false,
  days: [1, 3, 5], // Mon / Wed / Fri
  startTime: '07:00',
  endTime: '09:00',
  // One indoor net per session by default — a Corporate Batch session
  // physically occupies a single net. Admins can hold more per pitch type.
  netsConsumed: 1,
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
  if (!reservationAppliesToSlot(config, slot)) return 0;
  return resolveWicketsHeld(config).ASTRO;
}

/** True when the slot falls on a configured day and overlaps the window's
 *  [startTime, endTime) (IST). */
function reservationAppliesToSlot(
  window: { enabled: boolean; days: number[]; startTime: string; endTime: string },
  slot: BookableSlotWindow,
): boolean {
  if (!window.enabled) return false;
  const dow = getISTDayOfWeek(slot.startTime);
  if (window.days.length > 0 && !window.days.includes(dow)) return false;
  const slotStart = getISTHHMM(slot.startTime);
  const slotEnd = getISTHHMM(slot.endTime);
  // Treat as overlapping if any minute of the slot is inside the window.
  if (slotEnd <= window.startTime) return false;
  if (slotStart >= window.endTime) return false;
  return true;
}

/**
 * Sum the per-pitch wickets held for a slot across the corporate batch
 * window and every match-simulation session. Pure so it can be unit
 * tested; the raw configs are passed in.
 *
 *  - `corporate`  — the CORPORATE_BATCH_CONFIG window (or null).
 *  - `matchSimSessions` — MATCH_SIMULATION_CONFIG's session list; each
 *    session carries its own days/window and `wicketsHeld`.
 *
 * Every configured pitch type is honoured dynamically — adding a new
 * pitch type just needs its held count > 0 in the saved config.
 */
export function computeReservedByPitchForSlot(
  corporate: PitchReservationWindow | null | undefined,
  matchSimSessions: PitchReservationWindow[],
  slot: BookableSlotWindow,
): Record<HeldPitch, number> {
  const total: Record<HeldPitch, number> = { ASTRO: 0, CEMENT: 0, NATURAL: 0 };
  const add = (window: PitchReservationWindow) => {
    if (!reservationAppliesToSlot(window, slot)) return;
    const held = resolveWicketsHeld(window);
    // Every enabled match-practice session physically occupies one indoor
    // net. When the admin hasn't split a hold across pitch types, reserve a
    // single indoor (Astro) net by default so an active Corporate Batch /
    // Match Simulation session always blocks that net from regular bookings.
    // Any explicit per-pitch configuration (even a single non-Astro wicket)
    // overrides this default.
    if (held.ASTRO + held.CEMENT + held.NATURAL === 0) held.ASTRO = 1;
    total.ASTRO += held.ASTRO;
    total.CEMENT += held.CEMENT;
    total.NATURAL += held.NATURAL;
  };
  if (corporate) add(corporate);
  for (const session of matchSimSessions ?? []) add(session);
  return total;
}

/**
 * Per-pitch wickets held by every recurring reservation (corporate batch
 * + match simulation sessions) for the given slot. Reads both center
 * policies. The match-simulation config is a `{ sessions: [...] }` list;
 * we read it raw here to avoid a circular import with match-practice.ts.
 */
export async function getReservedByPitchForSlot(
  centerId: string,
  slot: BookableSlotWindow,
): Promise<Record<HeldPitch, number>> {
  const [corporate, matchSimRaw] = await Promise.all([
    getCorporateBatchConfig(centerId),
    getCenterOnlyPolicyJson<{ enabled?: boolean; sessions?: PitchReservationWindow[] }>(
      'MATCH_SIMULATION_CONFIG',
      centerId,
      { enabled: false, sessions: [] },
    ),
  ]);
  // A disabled match-simulation config holds nothing regardless of its
  // per-session flags.
  const sessions = matchSimRaw?.enabled && Array.isArray(matchSimRaw.sessions)
    ? matchSimRaw.sessions
    : [];
  return computeReservedByPitchForSlot(corporate, sessions, slot);
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

/** A single weekly recurring availability window for a coach/specialist.
 *
 *  Each window optionally carries an inclusive [effectiveFrom,
 *  effectiveTo] date range (IST). The window only applies to dates inside
 *  that range; a null bound means "no limit on that side". All windows
 *  saved together share the same effective range — it's a schedule-level
 *  attribute, persisted per row for simplicity. */
export interface AvailabilityWindow {
  dayOfWeek: number; // 0=Sun..6=Sat (IST)
  startTime: string; // HH:MM IST
  endTime: string;   // HH:MM IST
  effectiveFrom?: Date | null; // inclusive start, null = unbounded
  effectiveTo?: Date | null;   // inclusive end, null = unbounded
}

interface CenterMembershipUserRow {
  userId: string;
  metadata: unknown;
  /** Lower = first pick. Used by pickStaffFor / coach auto-assign to
   *  break ties when multiple memberships are equally eligible at a
   *  slot. Defaults to 100 when the column isn't set. */
  priority: number;
  user: { id: string; name: string | null; mobileNumber: string | null; email: string | null };
  /** Weekly recurring availability (with optional effective date range).
   *  Empty array = unavailable by default. */
  availability: AvailabilityWindow[];
}

/**
 * True if the slot falls inside the user's weekly availability schedule,
 * honouring each window's optional effective date range.
 *
 * A window matches when ALL of these hold:
 *   - the slot's IST weekday equals the window's dayOfWeek,
 *   - the slot's date is inside the window's [effectiveFrom, effectiveTo]
 *     range (a null bound = no limit on that side),
 *   - the slot's time fits entirely inside [startTime, endTime].
 *
 * An empty schedule returns `true` here (no constraint) — but the
 * membership-level wrapper below treats "no rows" as unavailable, so the
 * "empty = available" path is never reached for real coaches/specialists.
 */
export function slotMatchesAvailability(
  slot: BookableSlotWindow,
  windows: AvailabilityWindow[],
): boolean {
  if (!windows || windows.length === 0) return true;
  const dow = getISTDayOfWeek(slot.startTime);
  // fromDate/toDate are stored as @db.Date so they parse to UTC midnight;
  // comparing slot.date (also UTC midnight of the IST day) with `>=` /
  // `<=` works directly.
  const slotDateMs = slot.date.getTime();
  const dayWindows = windows.filter((w) => {
    if (w.dayOfWeek !== dow) return false;
    if (w.effectiveFrom && slotDateMs < w.effectiveFrom.getTime()) return false;
    if (w.effectiveTo && slotDateMs > w.effectiveTo.getTime()) return false;
    return true;
  });
  if (dayWindows.length === 0) return false;
  const slotStart = getISTHHMM(slot.startTime);
  const slotEnd = getISTHHMM(slot.endTime);
  // Slot must fit entirely inside at least one window.
  return dayWindows.some((w) => slotStart >= w.startTime && slotEnd <= w.endTime);
}

/**
 * Membership-level availability check.
 *
 * A coach/specialist is available for a slot only when their weekly
 * schedule (with its effective date range) covers it:
 *   - No weekly rows ⇒ unavailable by default.
 *   - Otherwise ⇒ the slot must match a weekly window whose effective
 *     date range includes the slot's date. Dates outside every window's
 *     effective range show no availability.
 */
export function slotMatchesMembershipAvailability(
  slot: BookableSlotWindow,
  weekly: AvailabilityWindow[],
): boolean {
  if (!weekly || weekly.length === 0) return false;
  return slotMatchesAvailability(slot, weekly);
}

export async function getCenterCoaches(centerId: string): Promise<CenterMembershipUserRow[]> {
  return prisma.centerMembership.findMany({
    where: { centerId, role: 'COACH', isActive: true },
    select: {
      userId: true,
      metadata: true,
      priority: true,
      availability: {
        where: { isActive: true },
        select: { dayOfWeek: true, startTime: true, endTime: true, effectiveFrom: true, effectiveTo: true },
      },
      user: { select: { id: true, name: true, mobileNumber: true, email: true } },
    },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
  });
}

/**
 * Center's ground-staff members, highest priority first. Unlike coaches /
 * sidearm specialists, ground staff are NOT an exclusive resource — they're
 * the floor contact and can cover several nets at once — so there's no
 * occupancy/conflict check here. Their weekly availability (with optional
 * effective date range) IS honored at assignment time, though: see
 * `pickGroundStaffForSlot`, which the engine uses to choose the default
 * assignee for facility bookings (Cricket Nets / Full Court / Corporate
 * Batch), mirroring how coaches and sidearm specialists are filtered by
 * availability.
 */
export async function getCenterGroundStaff(
  centerId: string,
): Promise<Array<{
  userId: string;
  availability: AvailabilityWindow[];
  user: { id: string; name: string | null; mobileNumber: string | null } | null;
}>> {
  return prisma.centerMembership.findMany({
    where: { centerId, role: 'GROUND_STAFF', isActive: true },
    select: {
      userId: true,
      availability: {
        where: { isActive: true },
        select: { dayOfWeek: true, startTime: true, endTime: true, effectiveFrom: true, effectiveTo: true },
      },
      user: { select: { id: true, name: true, mobileNumber: true } },
    },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
  });
}

/**
 * Default ground-staff contact for a facility booking at `slot`.
 *
 * Honors availability the same way coaches / sidearm specialists are
 * filtered: prefer the highest-priority member whose weekly schedule
 * (with its effective date range) covers the slot. Two ground-staff-
 * specific rules keep the floor-contact behaviour intact:
 *   - A member with NO availability configured is treated as always on the
 *     floor (the legacy default-contact behaviour), so existing centers
 *     that never set a schedule are unaffected.
 *   - If nobody is explicitly scheduled for the slot, fall back to the
 *     top-priority member so a facility booking never loses its contact
 *     when the center has any ground staff at all.
 *
 * Returns null only when the center has no active ground staff.
 */
export function pickGroundStaffForSlot(
  groundStaff: Array<{ userId: string; availability: AvailabilityWindow[] }>,
  slot: BookableSlotWindow,
): string | null {
  if (groundStaff.length === 0) return null;
  const available = groundStaff.find((gs) =>
    // Unconfigured = always available (default floor contact).
    gs.availability.length === 0 || slotMatchesMembershipAvailability(slot, gs.availability),
  );
  return (available ?? groundStaff[0]).userId;
}

export async function getCenterStaff(centerId: string): Promise<CenterMembershipUserRow[]> {
  return prisma.centerMembership.findMany({
    where: { centerId, role: 'SIDEARM_SPECIALIST', isActive: true },
    select: {
      userId: true,
      metadata: true,
      priority: true,
      availability: {
        where: { isActive: true },
        select: { dayOfWeek: true, startTime: true, endTime: true, effectiveFrom: true, effectiveTo: true },
      },
      user: { select: { id: true, name: true, mobileNumber: true, email: true } },
    },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
  });
}

// ─── Per-slot occupancy ──────────────────────────────────────────────

interface OccupancySnapshot {
  /**
   * Number of active bookings consuming each resource at the slot.
   * Keyed by Resource.id; value is the count of overlapping BookingResource
   * Assignment rows. A resource is "full" when load >= resource.capacity
   * (resources default to capacity 1, so any load makes them claimed).
   *
   * `claimedResourceIds` is kept as a derived view (resources at or above
   * capacity) so the rest of the engine and the consumers of this
   * snapshot don't need to thread capacity around. Producers MUST seed
   * `claimedResourceIds` only after they've also seeded `resourceLoad`
   * and have the resource list in hand to compare against capacity.
   */
  resourceLoad: Map<string, number>;
  /** Resources at or above their capacity at this slot. */
  claimedResourceIds: Set<string>;
  /** User IDs of coaches busy at the slot. */
  busyCoachIds: Set<string>;
  /** User IDs of sidearm staff busy at the slot. */
  busyStaffIds: Set<string>;
  /** Machine IDs busy at the slot. */
  busyMachineIds: Set<string>;
  /**
   * True when any non-cancelled FULL_COURT booking overlaps the slot.
   * Locks the entire indoor net pool — no MACHINE / NET / SIDEARM /
   * COACHING booking can land on indoor nets while a full-court
   * session is in progress, regardless of each net's remaining
   * capacity. Natural-turf / cement pools are unaffected (independent
   * surfaces). Required because BookingResourceAssignment has a unique
   * (booking, resource) constraint — full-court can only put 1 row per
   * net into the table, but the semantic is "claim every unit of every
   * net at this slot."
   */
  hasFullCourtBooking: boolean;
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
      // category drives the hasFullCourtBooking flag — a FULL_COURT
      // overlap claims the entire indoor pool regardless of capacity.
      category: true,
      assignedMachineId: true,
      assignedCoachId: true,
      assignedStaffId: true,
      resourceAssignments: { select: { resourceId: true } },
    },
  });

  // Resource load is computed against capacity inside
  // computeSlotAvailability — here we only collect raw counts.
  // claimedResourceIds is left empty; callers either re-derive it from
  // (load, capacity) via the resource list they already have, or use
  // the helper `withClaimedResourceIds` below when capacity isn't
  // handy (legacy behaviour: 1 booking = claimed).
  const resourceLoad = new Map<string, number>();
  const busyCoachIds = new Set<string>();
  const busyStaffIds = new Set<string>();
  const busyMachineIds = new Set<string>();
  let hasFullCourtBooking = false;

  for (const b of bookings) {
    if (!overlaps(b.startTime, b.endTime, slot.startTime, slot.endTime)) continue;
    for (const ra of b.resourceAssignments) {
      resourceLoad.set(ra.resourceId, (resourceLoad.get(ra.resourceId) ?? 0) + 1);
    }
    if (b.assignedCoachId) busyCoachIds.add(b.assignedCoachId);
    if (b.assignedStaffId) busyStaffIds.add(b.assignedStaffId);
    if (b.assignedMachineId) busyMachineIds.add(b.assignedMachineId);
    if (b.category === 'FULL_COURT') hasFullCourtBooking = true;
  }

  // Default `claimedResourceIds` treats any load as claimed (capacity=1
  // semantics). Callers with capacity knowledge overwrite this via
  // `withCapacityDerivedClaims` when they assemble the SlotAvailability.
  const claimedResourceIds = new Set<string>(resourceLoad.keys());

  return { resourceLoad, claimedResourceIds, busyCoachIds, busyStaffIds, busyMachineIds, hasFullCourtBooking };
}

/**
 * Recompute `claimedResourceIds` against the resource list so each
 * Resource's `capacity` is honoured. A resource is claimed only when
 * its current load reaches or exceeds capacity. Mutates the snapshot
 * in place (we own it) and returns it for chaining.
 *
 * Producers of the snapshot don't know capacity; consumers (the
 * availability engine, pickNetFor) do. So we keep the producer code
 * capacity-agnostic and recompute here.
 */
export function withCapacityDerivedClaims(
  occupancy: OccupancySnapshot,
  resources: ResourceLite[],
): OccupancySnapshot {
  const capacityById = new Map(resources.map((r) => [r.id, r.capacity ?? 1]));
  const claimed = new Set<string>();
  for (const [id, load] of occupancy.resourceLoad.entries()) {
    const cap = capacityById.get(id) ?? 1;
    if (load >= cap) claimed.add(id);
  }
  occupancy.claimedResourceIds = claimed;
  return occupancy;
}

// ─── Availability summary ────────────────────────────────────────────

export interface SlotAvailability {
  /** All indoor nets currently free (excludes corporate-batch reservation). */
  freeIndoorNets: ResourceLite[];
  /** All outdoor turf/cement wickets currently free. */
  freeOutdoorResources: ResourceLite[];
  /**
   * Free resources grouped by the pitch a booking would request:
   *   ASTRO   → INDOOR / NET resources (the synthetic-turf indoor pool)
   *   CEMENT  → resources of type CEMENT_WICKET (any category)
   *   NATURAL → resources of type TURF_WICKET (any category)
   *
   * Pools are independent — a booking with pitchType=NATURAL consumes
   * outdoor turf-wicket capacity, NOT indoor-net capacity. Lets a center
   * configure separate per-pitch capacities and have the engine honour
   * them without the legacy lumping-everything-into-indoor behaviour.
   */
  freeByPitch: {
    ASTRO: ResourceLite[];
    CEMENT: ResourceLite[];
    NATURAL: ResourceLite[];
  };
  /** Coaches free at this slot. */
  freeCoaches: CenterMembershipUserRow[];
  /** Sidearm staff free at this slot. */
  freeSidearmStaff: CenterMembershipUserRow[];
  /** Whether a FULL_COURT booking is achievable (every indoor net free + no reservation holding astro nets). */
  fullCourtAvailable: boolean;
  /** Total wickets held right now by recurring reservations (corporate
   *  batch + match simulation), summed across every pitch type. */
  corporateBatchNetsHeld: number;
  /** Wickets held per pitch type by recurring reservations at this slot. */
  reservedByPitch: Record<HeldPitch, number>;
}

/**
 * Map a pitch type to the Resource types that satisfy it. Used by both
 * the availability engine (group "free" resources by pitch) and
 * pickNetFor (filter the pool by the booking's pitch).
 *
 * The conventions:
 *   - ASTRO   → NET (synthetic turf — typical indoor net flooring)
 *   - CEMENT  → CEMENT_WICKET (dedicated cement wicket rows)
 *   - NATURAL → TURF_WICKET (natural-turf outdoor wickets)
 *
 * Unknown / null pitch falls back to NET so the legacy code path
 * (no pitch picked) still works.
 */
function resourceMatchesPitch(r: ResourceLite, pitch: string | null | undefined): boolean {
  if (!pitch) return r.type === 'NET';
  switch (pitch) {
    case 'ASTRO': return r.type === 'NET';
    case 'CEMENT': return r.type === 'CEMENT_WICKET';
    case 'NATURAL': return r.type === 'TURF_WICKET';
    default: return r.type === 'NET';
  }
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
  const [resources, coaches, staff, occupancy, reservedByPitch] = await Promise.all([
    getCenterResources(centerId),
    getCenterCoaches(centerId),
    getCenterStaff(centerId),
    getOccupancyForSlot(centerId, slot),
    getReservedByPitchForSlot(centerId, slot),
  ]);

  return computeSlotAvailability({ resources, coaches, staff, occupancy, reservedByPitch, slot });
}

interface AvailabilityInputs {
  resources: ResourceLite[];
  coaches: CenterMembershipUserRow[];
  staff: CenterMembershipUserRow[];
  occupancy: OccupancySnapshot;
  /** Legacy flat count of Astro/indoor nets held by the corporate batch.
   *  Folded into `reservedByPitch.ASTRO`. Prefer `reservedByPitch`. */
  batchNets?: number;
  /** Wickets held per pitch type by recurring reservations (corporate
   *  batch + match simulation) at this slot. */
  reservedByPitch?: Partial<Record<HeldPitch, number>>;
  /** When provided, additionally filter coaches/staff by their weekly
   *  availability schedule. Omit (or pass `null`) to skip the filter —
   *  primarily for callers that don't have a slot context. */
  slot?: BookableSlotWindow | null;
}

export function computeSlotAvailability(inputs: AvailabilityInputs): SlotAvailability {
  const { resources, coaches, staff, occupancy, slot } = inputs;
  // Combine the legacy astro-only `batchNets` with the per-pitch
  // `reservedByPitch` so callers can pass either (or both).
  const reserved: Record<HeldPitch, number> = {
    ASTRO: Math.max(0, (inputs.batchNets ?? 0) + (inputs.reservedByPitch?.ASTRO ?? 0)),
    CEMENT: Math.max(0, inputs.reservedByPitch?.CEMENT ?? 0),
    NATURAL: Math.max(0, inputs.reservedByPitch?.NATURAL ?? 0),
  };

  // Re-derive `claimedResourceIds` honouring per-resource capacity.
  // Producers (getOccupancyForSlot, the slot-grid loop) intentionally
  // populate `claimedResourceIds` with the capacity=1 default so the
  // capacity rules live in one place — here.
  withCapacityDerivedClaims(occupancy, resources);

  const indoorNets = resources.filter(
    (r) => r.category === 'INDOOR' && r.type === 'NET',
  );
  const outdoor = resources.filter((r) => r.category === 'OUTDOOR');

  // FULL_COURT lock: an overlapping full-court booking takes the
  // entire indoor pool, regardless of each net's remaining capacity.
  // Schema can't express that via BookingResourceAssignment (the
  // unique (booking, resource) constraint allows at most 1 row per
  // net), so the engine special-cases it here: when a FULL_COURT
  // overlaps the slot, every indoor NET is treated as claimed. This
  // is what prevents a 4-cap Indoor Net from accepting Machine /
  // Sidearm / Coaching / Net bookings while the court is "in use."
  // Outdoor / cement pools are untouched — they're independent surfaces.
  if (occupancy.hasFullCourtBooking) {
    for (const n of indoorNets) occupancy.claimedResourceIds.add(n.id);
  }

  // A resource with remaining capacity (load < capacity) is "free"
  // — it can host another booking at this slot. With every Resource at
  // capacity 1 this collapses back to the old "any booking = claimed"
  // behaviour, so legacy data stays correct.
  const freeIndoor = indoorNets.filter((r) => !occupancy.claimedResourceIds.has(r.id));
  const freeOutdoor = outdoor.filter((r) => !occupancy.claimedResourceIds.has(r.id));

  // Subtract recurring reservations (corporate batch + match simulation)
  // from each pitch's available pool. We virtually claim the LAST free
  // resources so the user-facing list still presents 1, 2, … as preferred.
  // Every configured pitch type is honoured dynamically — a center that
  // adds a new pitch just needs its wickets-held count > 0.
  const holdPool = (pool: ResourceLite[], count: number) => {
    const held = Math.min(Math.max(0, count), pool.length);
    return { held, free: pool.slice(0, pool.length - held) };
  };
  const astroHold = holdPool(freeIndoor, reserved.ASTRO);
  const freeIndoorAfterBatch = astroHold.free;
  const heldByBatch = astroHold.held;

  const freeCementRaw = resources.filter(
    (r) => resourceMatchesPitch(r, 'CEMENT') && !occupancy.claimedResourceIds.has(r.id),
  );
  const freeNaturalRaw = resources.filter(
    (r) => resourceMatchesPitch(r, 'NATURAL') && !occupancy.claimedResourceIds.has(r.id),
  );
  const cementHold = holdPool(freeCementRaw, reserved.CEMENT);
  const naturalHold = holdPool(freeNaturalRaw, reserved.NATURAL);

  const reservedHeld: Record<HeldPitch, number> = {
    ASTRO: astroHold.held,
    CEMENT: cementHold.held,
    NATURAL: naturalHold.held,
  };
  const totalHeld = reservedHeld.ASTRO + reservedHeld.CEMENT + reservedHeld.NATURAL;

  // Filter out coaches/staff whose schedule doesn't cover this slot, then
  // remove anyone already booked into another session at this time.
  // No `slot` provided ⇒ skip the schedule filter entirely.
  // A specialist is only offered for slots that fall on a configured
  // weekday AND inside that schedule's effective date range.
  const scheduledCoaches = slot
    ? coaches.filter((c) => slotMatchesMembershipAvailability(slot, c.availability))
    : coaches;
  const scheduledStaff = slot
    ? staff.filter((s) => slotMatchesMembershipAvailability(slot, s.availability))
    : staff;

  const freeCoaches = scheduledCoaches.filter((c) => !occupancy.busyCoachIds.has(c.userId));
  const freeStaff = scheduledStaff.filter((s) => !occupancy.busyStaffIds.has(s.userId));

  // Full court requires every active indoor net to be at zero load
  // (no other booking using any capacity unit) AND the corporate
  // batch to not be active. The capacity-aware "free" check above
  // accepts a net with load < capacity as free, which is wrong for
  // full-court — the whole net must be empty. Falling back to
  // resourceLoad.get(id) ?? 0 catches the "no bookings at all on
  // this net" case explicitly.
  const everyIndoorEmpty = indoorNets.every(
    (n) => (occupancy.resourceLoad.get(n.id) ?? 0) === 0,
  );
  const fullCourtAvailable =
    indoorNets.length > 0
    && everyIndoorEmpty
    && !occupancy.hasFullCourtBooking
    && heldByBatch === 0;

  // Per-pitch free pools. Each pitch keeps its own list so a booking
  // for NATURAL consumes outdoor turf capacity, not indoor net capacity.
  // Every pool uses its post-reservation free list so a recurring
  // reservation (corporate batch / match simulation) reduces that pitch's
  // capacity — dynamically, for whichever pitch types it holds wickets on.
  const freeByPitch = {
    ASTRO: freeIndoorAfterBatch.filter((r) => resourceMatchesPitch(r, 'ASTRO')),
    CEMENT: cementHold.free,
    NATURAL: naturalHold.free,
  };

  return {
    freeIndoorNets: freeIndoorAfterBatch,
    freeOutdoorResources: freeOutdoor,
    freeByPitch,
    freeCoaches,
    freeSidearmStaff: freeStaff,
    fullCourtAvailable,
    corporateBatchNetsHeld: totalHeld,
    reservedByPitch: reservedHeld,
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
  /** Axis for pitch-specific blocking. Mirroring the legacy field but
   *  explicitly consulted by the resource-based engine. */
  pitchType: PitchType | null;
  /**
   * Partial cricket-net cap. NULL = block every indoor net for this
   * window (legacy behaviour); a positive integer = block that many
   * indoor nets, leaving the rest of the pool bookable. Only consulted
   * when the block targets the indoor net pool (NET category and/or no
   * resourceIds pin). When the block already lists specific resourceIds
   * those are blocked verbatim and netCount is ignored — the admin
   * already told us which exact nets to block.
   */
  netCount: number | null;
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
      netCount: true,
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
      pitchType: b.pitchType ?? null,
      netCount: b.netCount ?? null,
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
 *
 * Indoor-pool cascade rules (see task 4 + 5):
 *   - A FULL_COURT-categorised block that doesn't pin specific
 *     resourceIds/machineRowIds locks the entire indoor net pool for
 *     the slot, so Cricket Net / Sidearm / Bowling Machine bookings
 *     on Astro turf are auto-blocked alongside Full Court itself.
 *   - A NET (Cricket Nets) block with `netCount = N` removes N indoor
 *     nets from the free pool (the last N in displayOrder, so the
 *     user-facing list keeps net 1, 2, … as preferred). When N is null
 *     the whole pool is blocked (legacy behaviour). When the block
 *     already pins specific resourceIds those are blocked verbatim and
 *     netCount is ignored.
 *   - Full-court remains "available" only when zero indoor nets are
 *     consumed by any block at this slot. A single net blocked (even
 *     a partial NET block with netCount=1) flips fullCourtAvailable
 *     to false — full court needs every net free.
 */

/**
 * Apply admin "count blocks" to a slot's occupancy as virtual load.
 *
 * A count block reserves N units of a pitch's pool (e.g. "block 3 of 4
 * Astro Turf units") without pinning a specific machine or resource. We
 * model that by consuming N units of capacity on the matching pitch's
 * resources here — BEFORE computeSlotAvailability runs — so every
 * downstream capacity rule (claimedResourceIds, freeByPitch, pickNetFor,
 * fullCourtAvailable) treats the reservation exactly like real bookings.
 * Mutates `resourceLoad` in place.
 *
 *   - pitch comes from the block's pitchType; a legacy count block with
 *     no pitch defaults to ASTRO (the indoor net pool).
 *   - netCount is the number of units to hold; null means "not a count
 *     block" (handled elsewhere as a category / pitch / catchall block).
 *   - blocks that pin a machine or resource are skipped — those are
 *     machine/resource-scoped, not pool-unit reservations.
 */
export function applyPitchReservations(
  resourceLoad: Map<string, number>,
  resources: ResourceLite[],
  blocks: ActiveBlock[],
  audience: 'ALL' | 'SPECIAL' | 'NON_SPECIAL' = 'ALL',
): void {
  const reserved: Record<'ASTRO' | 'CEMENT' | 'NATURAL', number> = { ASTRO: 0, CEMENT: 0, NATURAL: 0 };
  for (const b of blocks) {
    if (!appliesToAudience(b.appliesTo, audience)) continue;
    if (b.netCount == null || b.netCount <= 0) continue;
    if (b.machineRowIds.length > 0 || b.resourceIds.length > 0) continue;
    const pitch = (b.pitchType ?? 'ASTRO');
    if (pitch === 'ASTRO' || pitch === 'CEMENT' || pitch === 'NATURAL') {
      reserved[pitch] += b.netCount;
    }
  }

  (['ASTRO', 'CEMENT', 'NATURAL'] as const).forEach((pitch) => {
    let remaining = reserved[pitch];
    if (remaining <= 0) return;
    // Fill the pitch's resources up to capacity, in order, so the held
    // units behave like bookings against real capacity.
    for (const r of resources) {
      if (remaining <= 0) break;
      if (!resourceMatchesPitch(r, pitch)) continue;
      const cap = r.capacity ?? 1;
      const cur = resourceLoad.get(r.id) ?? 0;
      const take = Math.min(Math.max(0, cap - cur), remaining);
      if (take > 0) {
        resourceLoad.set(r.id, cur + take);
        remaining -= take;
      }
    }
  });
}

export function applyBlocksToAvailability(
  availability: SlotAvailability,
  blocks: ActiveBlock[],
  audience: 'ALL' | 'SPECIAL' | 'NON_SPECIAL' = 'ALL',
): {
  availability: SlotAvailability;
  blockedCategories: Set<BookingCategory>;
  blockedMachineRowIds: Set<string>;
  blockedByPitch: Record<PitchType, { categories: Set<BookingCategory>; machineRowIds: Set<string> }>;
} {
  const blockedCategories = new Set<BookingCategory>();
  const blockedMachineRowIds = new Set<string>();
  const blockedByPitch: Record<PitchType, { categories: Set<BookingCategory>; machineRowIds: Set<string> }> = {
    ASTRO: { categories: new Set(), machineRowIds: new Set() },
    CEMENT: { categories: new Set(), machineRowIds: new Set() },
    NATURAL: { categories: new Set(), machineRowIds: new Set() },
    TURF: { categories: new Set(), machineRowIds: new Set() },
  };
  const blockedResourceIds = new Set<string>();
  // True when a catchall block (no axes) claims every pool at this slot.
  let indoorPoolFullyClaimed = false;

  for (const b of blocks) {
    if (!appliesToAudience(b.appliesTo, audience)) continue;

    // Helper to add to specific pitch or all if null
    const addToPitch = (
      p: PitchType | null,
      cats: BookingCategory[],
      mIds: string[],
    ) => {
      const targets = p ? [p] : (Object.keys(blockedByPitch) as PitchType[]);
      for (const pitch of targets) {
        for (const c of cats) blockedByPitch[pitch].categories.add(c);
        for (const id of mIds) blockedByPitch[pitch].machineRowIds.add(id);
      }
      // Also add to global sets for legacy compatibility / fallback
      for (const c of cats) blockedCategories.add(c);
      for (const id of mIds) blockedMachineRowIds.add(id);
    };

    // Categories only act as a *blanket* category block (greying out the
    // whole tab/pitch) when the block does NOT pin a specific machine or
    // resource. With a machine/resource pin the category is just an AND
    // co-constraint: "MACHINE + Yantra + Astro" must block Yantra on
    // Astro only — every other machine (and every other category) on
    // Astro stays independently bookable. So when a pin is present we
    // contribute ONLY the machine pin to the per-pitch sets and leave the
    // category open. Without this, picking the Bowling Machine category
    // alongside a single machine greyed out the entire Astro tab.
    const hasResourcePin = b.machineRowIds.length > 0 || b.resourceIds.length > 0;

    // A "count block" (netCount set, no machine/resource pin) reserves N
    // units of a pitch's pool capacity — it's applied as virtual load by
    // applyPitchReservations BEFORE availability is computed, so the pool
    // here already reflects it. It must NOT also contribute its categories
    // (that would hard-block the whole category instead of just reserving
    // units), so we contribute no categories — same as a pinned block.
    const isCountBlock =
      b.netCount != null
      && b.netCount > 0
      && b.machineRowIds.length === 0
      && b.resourceIds.length === 0;
    const categoriesForGrid = (hasResourcePin || isCountBlock) ? [] : b.categories;

    addToPitch(b.pitchType, categoriesForGrid, b.machineRowIds);
    for (const id of b.resourceIds) blockedResourceIds.add(id);

    // CATCHALL — neither category, machineRow, nor resource targeted +
    // no legacy axes either → block every category.
    const hasAnyAxis =
      b.categories.length +
        b.machineRowIds.length +
        b.resourceIds.length +
        b.legacyMachineIds.length +
        (b.pitchType ? 1 : 0) +
        (b.legacyMachineId ? 1 : 0) +
        (b.legacyMachineType ? 1 : 0) +
        (b.legacyPitchType ? 1 : 0) >
      0;
    if (!hasAnyAxis) {
      // Block every booking-category we know about. The frontend uses
      // this to grey out every tab in the slot picker.
      const ALL_CATS: BookingCategory[] = ['MACHINE', 'SIDEARM', 'COACHING', 'NET', 'FULL_COURT', 'CORPORATE_BATCH', 'MATCH_SIMULATION'];
      addToPitch(null, ALL_CATS, []);

      // Catchall — claims the whole indoor pool too.
      indoorPoolFullyClaimed = true;
      continue;
    }

    // Pitch-only block: a block that names ONLY a pitch (no category,
    // machine, or resource) blocks every booking on that pitch. Mirror it
    // in the per-pitch categories set so the slot grid greys out that
    // pitch's tabs, matching evaluateBlockForBooking (which blocks any
    // booking whose pitch matches). Kept to the per-pitch set so a
    // NATURAL-only block doesn't leak into the indoor/global fallback.
    const isPitchOnlyBlock =
      !!b.pitchType
      && b.categories.length === 0
      && b.machineRowIds.length === 0
      && b.resourceIds.length === 0
      && b.netCount == null; // a count block reserves units, it isn't a full-pitch block
    if (isPitchOnlyBlock && b.pitchType) {
      const ALL_CATS: BookingCategory[] = ['MACHINE', 'SIDEARM', 'COACHING', 'NET', 'FULL_COURT', 'CORPORATE_BATCH', 'MATCH_SIMULATION'];
      for (const c of ALL_CATS) blockedByPitch[b.pitchType].categories.add(c);
    }

    // FULL_COURT is an INDEPENDENT category. Blocking it takes only the
    // "Full Indoor Court" option off the board (via blockedCategories →
    // fullCourtAvailable below). It does NOT cascade to the individual
    // Cricket Net / Bowling Machine / Sidearm / Coaching bookings — those
    // stay available unless their own net pool is exhausted. (A real
    // full-court *booking* still physically claims every net; that
    // coupling lives in computeSlotAvailability, not in block handling.)

    // Count-based unit reservations (block N units of a pitch) are NOT
    // handled here — they're applied as virtual load by
    // applyPitchReservations before computeSlotAvailability runs, so the
    // pool we receive already reflects them. This keeps the per-category
    // independence intact: a "Cricket Nets" category block only blocks
    // NET bookings; reserving units is a separate, pool-level concept.
  }

  // Apply per-resource pins first.
  let freeIndoor = availability.freeIndoorNets.filter((r) => !blockedResourceIds.has(r.id));
  const freeOutdoor = availability.freeOutdoorResources.filter((r) => !blockedResourceIds.has(r.id));

  // A catchall block claims the whole indoor pool.
  if (indoorPoolFullyClaimed) {
    freeIndoor = [];
  }

  // Per-pitch lists ride on the now-filtered pools. ASTRO uses the indoor
  // net pool; CEMENT and NATURAL are independent outdoor surfaces only
  // affected by their own resource pins (and the catchall, which empties
  // every pool).
  const stillFreeIndoorIds = new Set(freeIndoor.map((r) => r.id));
  const astroFiltered = availability.freeByPitch.ASTRO.filter((r) => stillFreeIndoorIds.has(r.id));
  const cementFiltered = indoorPoolFullyClaimed
    ? []
    : availability.freeByPitch.CEMENT.filter((r) => !blockedResourceIds.has(r.id));

  // Full Court is unavailable when a full-court block is set or a catchall
  // claims the pool. Capacity consumed by unit reservations / live
  // bookings already flips availability.fullCourtAvailable false upstream.
  const fullCourtBlocked = blockedCategories.has('FULL_COURT')
    || indoorPoolFullyClaimed;

  const filteredAvailability: SlotAvailability = {
    ...availability,
    freeIndoorNets: freeIndoor,
    freeOutdoorResources: freeOutdoor,
    freeByPitch: {
      ASTRO: astroFiltered,
      CEMENT: cementFiltered,
      NATURAL: indoorPoolFullyClaimed
        ? []
        : availability.freeByPitch.NATURAL.filter((r) => !blockedResourceIds.has(r.id)),
    },
    fullCourtAvailable: availability.fullCourtAvailable && !fullCourtBlocked,
  };

  // Cascade: when a FULL_COURT or catchall block hits, suppress every
  // Note: blockedCategories / blockedMachineRowIds / blockedByPitch
  // are NOT updated here — they only represent categorical blocks.
  // Resource-level pins are reflected in filteredAvailability.
  return {
    availability: filteredAvailability,
    blockedCategories,
    blockedMachineRowIds,
    blockedByPitch,
  };
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
 *
 * The category-cascade rule from task 4: a block whose categories list
 * contains FULL_COURT (and does NOT pin specific resourceIds) blocks
 * every indoor-pool booking at the slot — NET / SIDEARM / MACHINE /
 * FULL_COURT itself — because a "Full Indoor Court" reservation by
 * definition claims every indoor net.
 *
 * The partial-NET rule from task 5: a NET block with `netCount=N` only
 * fills the indoor pool partially. Whether a *new* NET / MACHINE /
 * SIDEARM booking is blocked depends on remaining capacity — that's
 * already checked by the resource-pool emptiness gate in `planBooking`,
 * so we don't reject the booking from here on netCount alone.
 */
export function evaluateBlockForBooking(
  blocks: ActiveBlock[],
  booking: {
    category: BookingCategory;
    machineRowId?: string | null;
    resourceIds: string[];
    pitchType?: string | null;
  },
  audience: 'ALL' | 'SPECIAL' | 'NON_SPECIAL' = 'ALL',
): string | null {
  // FULL_COURT is an independent category — a block on it blocks only
  // FULL_COURT bookings, handled by the normal axis matching below. It
  // does NOT cascade to Cricket Net / Sidearm / Bowling Machine bookings.

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
      if (booking.resourceIds.some((rid) => b.resourceIds.includes(rid))) axisMatched++;
    }

    // AXIS 4: Pitch Type (Mirroring legacy pitchType field)
    // If the block pins a pitch, only bookings on that pitch are blocked.
    if (b.pitchType) {
      axisCount++;
      if (booking.pitchType === b.pitchType) axisMatched++;
    }

    // Count block (reserve N units of a pitch pool): never a hard block.
    // The reservation is applied as virtual load before availability is
    // computed, so the pool-emptiness check in pickNetFor enforces the
    // remaining capacity. Bouncing the booking here would wrongly block
    // EVERY booking on the pitch instead of just the reserved N units.
    if (
      b.netCount != null
      && b.netCount > 0
      && b.machineRowIds.length === 0
      && b.resourceIds.length === 0
    ) {
      continue;
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
  /**
   * Pitch the booking should sit on. Drives the resource-pool selection
   * (ASTRO → indoor NET, CEMENT → CEMENT_WICKET, NATURAL → TURF_WICKET).
   * Null/omitted falls back to the indoor net pool — matches the legacy
   * 'no pitch picked' behaviour.
   */
  pitchType?: string | null;
  /** For CORPORATE_BATCH only: how many nets to take. Overrides the policy. */
  corporateNets?: number;
}

export interface PlannedAssignment {
  category: BookingCategory;
  resourceIds: string[];
  machineId: string | null;
  coachId: string | null;
  staffId: string | null;
  // Ground-staff member handling a facility booking (NET / FULL_COURT /
  // CORPORATE_BATCH). Null for MACHINE/SIDEARM/COACHING.
  groundStaffId: string | null;
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
    /**
     * Operator availability for MACHINE bookings. The engine itself
     * doesn't query operator schedules — that lives in
     * `lib/operatorAssign.ts` and the route handler computes it
     * before calling planBooking. When `required` is true and
     * `available` is false, the booking is rejected immediately so
     * leather-ball / operator-mandatory machines can't be booked
     * during an operator-unavailable window (admin date override,
     * weekly off, or every scheduled operator already busy).
     * SELF_OPERATE is intentionally NOT a fallback here — that's
     * only valid for tennis machines, which the route flags by
     * passing `required: false`.
     */
    operator?: { required: boolean; available: boolean };
  } = {},
): Promise<PlannedAssignment> {
  const slot: BookableSlotWindow = {
    date: plan.date,
    startTime: plan.startTime,
    endTime: plan.endTime,
  };
  const [resources, coaches, staff, groundStaff, occupancy, reservedByPitch, blocks] = await Promise.all([
    getCenterResources(plan.centerId),
    getCenterCoaches(plan.centerId),
    getCenterStaff(plan.centerId),
    getCenterGroundStaff(plan.centerId),
    getOccupancyForSlot(plan.centerId, slot, context.tx),
    getReservedByPitchForSlot(plan.centerId, slot),
    getActiveBlocksForSlot(plan.centerId, slot),
  ]);
  // Default facility assignee — the top-priority active ground-staff
  // member who is available for this slot (falls back to top-priority,
  // then null). Used for NET / FULL_COURT / CORPORATE_BATCH; null when the
  // center has no ground staff configured.
  const defaultGroundStaffId = pickGroundStaffForSlot(groundStaff, slot);
  const audience = context.audience ?? 'ALL';
  // Hold admin "count blocks" (block N units of a pitch) as virtual load
  // before computing availability so this booking respects the reserved
  // units — pool emptiness in pickNetFor enforces the remaining capacity.
  applyPitchReservations(occupancy.resourceLoad, resources, blocks, audience);
  const availability = computeSlotAvailability({ resources, coaches, staff, occupancy, reservedByPitch, slot });

  // Pre-flight category-level block check. Refuses early when an
  // entire category is blocked at this slot — the resource-specific
  // checks downstream catch the more granular cases.
  const categoryBlock = evaluateBlockForBooking(
    blocks,
    {
      category: plan.category,
      machineRowId: plan.machineId ?? null,
      resourceIds: plan.resourceIds ?? [],
      // Pitch axis: a machine+pitch block (e.g. "Yantra on Natural Turf")
      // must only bite the matching pitch. Without this the pitch axis
      // could never match and pitch-scoped blocks were silently ignored.
      pitchType: plan.pitchType ?? null,
    },
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
      // Operator availability gate. The route handler resolves
      // `operator.required` from the picked machine's MachineType.ballType
      // (LEATHER → required, TENNIS → not required) and `operator.available`
      // from getOperatorCount + live busy count. We reject here so a
      // leather-ball booking can't slip through during an operator-
      // unavailable window — same outcome whether the admin set
      // operatorCount=0 (date override / weekly off) or every
      // scheduled operator was already booked.
      if (context.operator?.required && !context.operator.available) {
        throw new BookingResourceError(
          'Operator unavailable for this slot — this machine requires an operator',
          409,
        );
      }
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
        groundStaffId: null,
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
        groundStaffId: null,
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
        groundStaffId: null,
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
        groundStaffId: defaultGroundStaffId,
      };
    }
    case 'CORPORATE_BATCH': {
      // LEGACY PATH — user-facing corporate-batch bookings are now
      // seat-based enrollments handled by src/lib/match-practice.ts;
      // the booking route dispatches them before calling planBooking.
      // This case is kept for any remaining caller that still asks the
      // resource planner to claim nets explicitly (admin overrides):
      //  - Caller pre-supplied resourceIds → use them (admin override).
      //  - Otherwise → auto-claim the configured number of indoor nets,
      //    matching the policy-driven virtual reservation.
      if (plan.resourceIds && plan.resourceIds.length > 0) {
        return {
          category: 'CORPORATE_BATCH',
          resourceIds: plan.resourceIds,
          machineId: null,
          coachId: null,
          staffId: null,
          groundStaffId: defaultGroundStaffId,
        };
      }
      const config = await getCorporateBatchConfig(plan.centerId);
      // Auto-claim indoor (Astro) nets. `resolveWicketsHeld` normalises
      // both the new per-pitch `wicketsHeld` and the legacy `netsConsumed`
      // shape down to an Astro count for this indoor-net path.
      const nets = Math.max(1, plan.corporateNets ?? resolveWicketsHeld(config).ASTRO);
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
        groundStaffId: defaultGroundStaffId,
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
        groundStaffId: defaultGroundStaffId,
      };
    }
    case 'MATCH_SIMULATION': {
      // Match Practice sessions are seat-based, not resource-based —
      // they're handled by src/lib/match-practice.ts and the booking
      // route dispatches them before ever calling planBooking. Reaching
      // here means a caller wired the category into the wrong engine.
      throw new BookingResourceError(
        'Match simulation bookings are seat-based — not handled by the resource planner',
        400,
      );
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
      pitchType: plan.pitchType ?? null,
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
  // Pitch-driven pool selection. The user's pitch pick maps to a
  // Resource type via resourceMatchesPitch:
  //   ASTRO   → NET (synthetic turf indoor pool)
  //   CEMENT  → CEMENT_WICKET (cement wickets, often outdoor)
  //   NATURAL → TURF_WICKET (natural-turf outdoor wickets)
  // Each pool is independent: a NATURAL booking can't eat into the
  // indoor net capacity, and vice versa. When no pitch is supplied
  // we default to the indoor NET pool, matching the legacy behaviour
  // for callers that don't yet pass pitchType.
  const pitch = plan.pitchType ?? null;

  // Caller-pinned resource wins, but it still has to match the
  // requested pitch — picking an outdoor turf wicket for an ASTRO
  // booking would steer the user onto the wrong surface.
  if (plan.resourceIds && plan.resourceIds.length > 0) {
    const id = plan.resourceIds[0];
    const r = resources.find((x) => x.id === id);
    if (!r) {
      throw new BookingResourceError('Resource not found', 400);
    }
    if (occupancy.claimedResourceIds.has(id)) {
      throw new BookingResourceError(`Resource "${r.name}" is already booked`, 409);
    }
    if (pitch && !resourceMatchesPitch(r, pitch)) {
      throw new BookingResourceError(
        `Resource "${r.name}" doesn't support the ${pitch.toLowerCase()} pitch`,
        400,
      );
    }
    return r;
  }

  // Prefer the machine's home net if set + free AND it matches the
  // requested pitch. A leather machine pinned to an indoor net
  // shouldn't try to take an outdoor turf wicket; fall through to the
  // pool below when the home net doesn't match the pitch.
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
      if (
        home
        && !occupancy.claimedResourceIds.has(home.id)
        && (!pitch || resourceMatchesPitch(home, pitch))
      ) {
        return home;
      }
    }
  }

  // Pool selection: pull from the per-pitch free list when the user
  // picked a pitch; fall back to indoor nets otherwise. Each pool is
  // independent so a NATURAL booking only consumes outdoor turf
  // capacity — it can't accidentally eat an indoor net slot.
  const pool = pitch
    ? availability.freeByPitch[pitch as 'ASTRO' | 'CEMENT' | 'NATURAL'] ?? []
    : availability.freeIndoorNets;
  const candidate = pool[0];
  if (!candidate) {
    if (pitch === 'NATURAL') {
      throw new BookingResourceError(
        'All natural turf wickets are taken at this slot',
        409,
      );
    }
    if (pitch === 'CEMENT') {
      throw new BookingResourceError(
        'All cement wickets are taken at this slot',
        409,
      );
    }
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
