/**
 * Resource-based booking engine — Toplay and any future center using
 * `Center.bookingModel = RESOURCE_BASED`.
 *
 * ### Mental model
 *
 * A center has Resources (nets, courts, turf wickets) and can have
 * Coaches and Sidearm staff (Users with COACH / SIDEARM_STAFF
 * memberships). Each Booking falls under one of:
 *
 *   - MACHINE         — consumes 1 net + 1 Machine instance
 *   - SIDEARM         — consumes 1 net + 1 SIDEARM_STAFF user
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
import { getPolicyJson } from '@/lib/policy';
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

export const DEFAULT_CORPORATE_BATCH_CONFIG: CorporateBatchConfig = {
  enabled: true,
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
  return getPolicyJson('CORPORATE_BATCH_CONFIG', centerId, DEFAULT_CORPORATE_BATCH_CONFIG);
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

interface CenterMembershipUserRow {
  userId: string;
  metadata: unknown;
  user: { id: string; name: string | null; mobileNumber: string | null; email: string | null };
}

export async function getCenterCoaches(centerId: string): Promise<CenterMembershipUserRow[]> {
  return prisma.centerMembership.findMany({
    where: { centerId, role: 'COACH', isActive: true },
    select: {
      userId: true,
      metadata: true,
      user: { select: { id: true, name: true, mobileNumber: true, email: true } },
    },
  });
}

export async function getCenterStaff(centerId: string): Promise<CenterMembershipUserRow[]> {
  return prisma.centerMembership.findMany({
    where: { centerId, role: 'SIDEARM_STAFF', isActive: true },
    select: {
      userId: true,
      metadata: true,
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
): Promise<OccupancySnapshot> {
  // We pull only the columns we need. Prisma's date filter is exact-day
  // (Booking.date is @db.Date), and startTime/endTime are full timestamps.
  const bookings = await prisma.booking.findMany({
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

  return computeSlotAvailability({ resources, coaches, staff, occupancy, batchNets });
}

interface AvailabilityInputs {
  resources: ResourceLite[];
  coaches: CenterMembershipUserRow[];
  staff: CenterMembershipUserRow[];
  occupancy: OccupancySnapshot;
  batchNets: number;
}

export function computeSlotAvailability(inputs: AvailabilityInputs): SlotAvailability {
  const { resources, coaches, staff, occupancy, batchNets } = inputs;

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

  const freeCoaches = coaches.filter((c) => !occupancy.busyCoachIds.has(c.userId));
  const freeStaff = staff.filter((s) => !occupancy.busyStaffIds.has(s.userId));

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

export async function planBooking(plan: BookingPlan): Promise<PlannedAssignment> {
  const slot: BookableSlotWindow = {
    date: plan.date,
    startTime: plan.startTime,
    endTime: plan.endTime,
  };
  const [resources, coaches, staff, occupancy, batchNets] = await Promise.all([
    getCenterResources(plan.centerId),
    getCenterCoaches(plan.centerId),
    getCenterStaff(plan.centerId),
    getOccupancyForSlot(plan.centerId, slot),
    getCorporateBatchNetsForSlot(plan.centerId, slot),
  ]);
  const availability = computeSlotAvailability({ resources, coaches, staff, occupancy, batchNets });

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

  // Per-category resolution.
  switch (plan.category) {
    case 'MACHINE': {
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
      // Admin-managed: the caller pre-supplies the resources to claim.
      // (This category exists primarily so the bookings table can track
      // an actual row — usually we model the batch via the policy and
      // skip the row entirely.)
      if (!plan.resourceIds || plan.resourceIds.length === 0) {
        throw new BookingResourceError('Corporate batch booking must specify resourceIds', 400);
      }
      return {
        category: 'CORPORATE_BATCH',
        resourceIds: plan.resourceIds,
        machineId: null,
        coachId: null,
        staffId: null,
      };
    }
  }
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
