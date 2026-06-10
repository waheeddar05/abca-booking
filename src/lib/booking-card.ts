import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

/**
 * Shared booking → "card" projection.
 *
 * The user-facing <BookingCard> (My Bookings page) and the in-app Alerts
 * view both render the exact same booking snapshot. To guarantee they stay
 * identical, the Prisma `include` and the field mapping live here once and
 * are reused by:
 *   - GET /api/bookings              (the My Bookings list)
 *   - GET /api/notifications         (booking-linked alerts)
 *
 * If you add a field the card shows, add it here and both surfaces pick it
 * up together.
 */

// Relations the card needs. Scalars (price, status, cancelledBy, …) come
// automatically because callers use this as an `include`, not a `select`.
export const BOOKING_CARD_INCLUDE = {
  operator: {
    select: { name: true, mobileNumber: true },
  },
  // Resource-based fields surface the machine / coach / staff names. For
  // ABCA (MACHINE_PITCH) bookings these are all null and the card falls
  // back to the legacy machineId label.
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
  // Ground-staff member assigned to a facility booking (Cricket Nets /
  // Full Court / Corporate Batch). Per-booking; the card falls back to the
  // center's default ground staff when this is null (legacy rows).
  assignedGroundStaff: { select: { id: true, name: true, mobileNumber: true } },
  // Center context — shown on every booking card so users know which
  // center, where, and how to reach it without leaving the page.
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
      // Ground staff are the default contact for Cricket Nets and Full
      // Indoor Court bookings (categories with no per-booking operator /
      // coach / sidearm row). Pull the highest-priority active
      // GROUND_STAFF membership; BookingCard surfaces them as a 'Call'
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
} satisfies Prisma.BookingInclude;

export interface BookingCardRefund {
  method: string;
  amount: number;
  refundedAt: string | null;
  refunds: Array<{ method: string; amount: number; status: string; refundedAt: string }>;
}

/** The shape both /api/bookings and /api/notifications return per booking. */
export interface BookingCardData {
  id: string;
  centerId: string | null;
  date: string;
  startTime: string;
  endTime: string;
  ballType: string;
  playerName: string;
  status: string;
  price: number | null;
  originalPrice: number | null;
  discountAmount: number | null;
  discountType: string | null;
  pitchType: string | null;
  extraCharge: number | null;
  operationMode: string;
  machineId: string | null;
  createdBy: string | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
  paymentMethod: string | null;
  paymentStatus: string | null;
  refund: BookingCardRefund | null;
  kitRental: boolean;
  kitRentalCharge: number | null;
  createdAt: string | null;
  isPackageBooking: boolean;
  packageName: string | null;
  operatorName: string | null;
  operatorMobile: string | null;
  category: string | null;
  assignedMachineName: string | null;
  assignedMachineFullName: string | null;
  assignedCoachName: string | null;
  assignedStaffName: string | null;
  assignedGroundStaff: { id: string; name: string | null; mobileNumber: string | null } | null;
  center: {
    id: string;
    name: string;
    shortName: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
    contactPhone: string | null;
    contactEmail: string | null;
    mapUrl: string | null;
    groundStaff: { id: string; name: string | null; mobileNumber: string | null } | null;
  } | null;
}

/** A booking row loaded with BOOKING_CARD_INCLUDE. */
export type BookingWithCardIncludes = Prisma.BookingGetPayload<{
  include: typeof BOOKING_CARD_INCLUDE;
}>;

/**
 * Map a booking row (loaded with BOOKING_CARD_INCLUDE) plus its refund /
 * package context into the card payload. Pure — no DB access. Accepts a
 * loosely-typed row too (the /api/bookings fallback path selects a subset
 * of columns) — every field access below is null-safe.
 */
export function mapBookingForCard(
  b: BookingWithCardIncludes,
  opts: { refund: BookingCardRefund | null; isPackageBooking: boolean },
): BookingCardData {
  return {
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
    refund: opts.refund,
    kitRental: b.kitRental ?? false,
    kitRentalCharge: b.kitRentalCharge ?? null,
    createdAt: b.createdAt ? b.createdAt.toISOString() : null,
    isPackageBooking: opts.isPackageBooking,
    packageName: b.packageBooking?.userPackage?.package?.name || null,
    operatorName: b.operator?.name || null,
    operatorMobile: b.operator?.mobileNumber || null,
    category: b.category ?? null,
    assignedMachineName: b.assignedMachine
      ? b.assignedMachine.shortName || b.assignedMachine.name
      : null,
    assignedMachineFullName: b.assignedMachine?.name ?? null,
    assignedCoachName: b.assignedCoach?.name ?? null,
    assignedStaffName: b.assignedStaff?.name ?? null,
    assignedGroundStaff: b.assignedGroundStaff
      ? {
          id: b.assignedGroundStaff.id,
          name: b.assignedGroundStaff.name ?? null,
          mobileNumber: b.assignedGroundStaff.mobileNumber ?? null,
        }
      : null,
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
          groundStaff: (() => {
            const gs = (b.center.memberships ?? [])[0]?.user;
            return gs
              ? { id: gs.id, name: gs.name ?? null, mobileNumber: gs.mobileNumber ?? null }
              : null;
          })(),
        }
      : null,
  };
}

/**
 * Build the per-booking refund map (active refunds only, newest first) for
 * a set of booking ids. Mirrors the shape <BookingCard> expects. Best-effort
 * — returns an empty map if the Refund table isn't available.
 */
async function loadRefundMap(bookingIds: string[]): Promise<Record<string, BookingCardRefund>> {
  const map: Record<string, BookingCardRefund> = {};
  if (bookingIds.length === 0) return map;
  try {
    const refunds = await prisma.refund.findMany({
      where: { bookingId: { in: bookingIds }, status: { not: 'FAILED' } },
      select: { bookingId: true, amount: true, method: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    for (const r of refunds) {
      if (!map[r.bookingId]) {
        map[r.bookingId] = { method: r.method, amount: 0, refundedAt: null, refunds: [] };
      }
      map[r.bookingId].amount += r.amount;
      map[r.bookingId].refunds.push({
        method: r.method,
        amount: r.amount,
        status: r.status,
        refundedAt: r.createdAt.toISOString(),
      });
    }
    // refundedAt = newest refund timestamp (refunds are ordered desc).
    for (const id of Object.keys(map)) {
      map[id].refundedAt = map[id].refunds[0]?.refundedAt ?? null;
    }
  } catch {
    // ignore — table may not exist in some environments
  }
  return map;
}

/**
 * Fetch the card payloads for a set of booking ids, keyed by id. Used by the
 * notifications API to attach a Bookings-page snapshot to each
 * booking-linked alert. Resilient: any failure yields an empty map so the
 * caller (alerts list) still renders without the snapshots.
 */
export async function loadBookingCards(
  bookingIds: string[],
): Promise<Map<string, BookingCardData>> {
  const result = new Map<string, BookingCardData>();
  const ids = Array.from(new Set(bookingIds.filter(Boolean)));
  if (ids.length === 0) return result;

  try {
    const [bookings, refundMap, packageBookings] = await Promise.all([
      prisma.booking.findMany({ where: { id: { in: ids } }, include: BOOKING_CARD_INCLUDE }),
      loadRefundMap(ids),
      prisma.packageBooking
        .findMany({ where: { bookingId: { in: ids } }, select: { bookingId: true } })
        .catch(() => [] as { bookingId: string }[]),
    ]);

    const packageSet = new Set(packageBookings.map((pb) => pb.bookingId));
    for (const b of bookings) {
      result.set(
        b.id,
        mapBookingForCard(b, {
          refund: refundMap[b.id] ?? null,
          isPackageBooking: packageSet.has(b.id),
        }),
      );
    }
  } catch (err) {
    console.error('[booking-card] loadBookingCards failed:', err);
  }
  return result;
}
