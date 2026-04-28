import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma, type BookingCategory } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser, hasMembershipRole } from '@/lib/auth';
import { resolveCurrentCenter } from '@/lib/centers';
import {
  planBooking,
  persistResourceAssignments,
  BookingResourceError,
  type BookingPlan,
} from '@/lib/resource-booking';
import { getResourceSlotPrice } from '@/lib/resource-pricing';
import { dateStringToUTC } from '@/lib/time';

/**
 * POST /api/slots/book-resource
 *
 * Resource-based booking creation. Intended for centers with
 * `bookingModel = RESOURCE_BASED`.
 *
 * Body:
 * {
 *   slots: [{ date: 'YYYY-MM-DD', startTime, endTime }],
 *   category: 'MACHINE' | 'SIDEARM' | 'COACHING' | 'FULL_COURT' | 'CORPORATE_BATCH',
 *   playerName,
 *   resourceIds?: string[],   // optional pin (otherwise engine picks)
 *   machineId?: string,       // for MACHINE
 *   coachId?: string,         // for COACHING
 *   staffId?: string,         // for SIDEARM
 *   userId?: string,          // admin can book on behalf
 *   paymentMethod?: 'ONLINE' | 'CASH'
 * }
 *
 * Behaviour: each slot becomes one Booking row. Resource assignments
 * are atomic — if any slot fails, none are created. Pricing comes from
 * `RESOURCE_PRICING_CONFIG` (per center, with override for Yantra).
 */

const SlotSchema = z.object({
  date: z.string().min(1),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
});

const BodySchema = z.object({
  slots: z.array(SlotSchema).min(1).max(8),
  category: z.enum(['MACHINE', 'SIDEARM', 'COACHING', 'FULL_COURT', 'CORPORATE_BATCH']),
  playerName: z.string().min(1).max(120),
  resourceIds: z.array(z.string()).optional(),
  machineId: z.string().optional().nullable(),
  coachId: z.string().optional().nullable(),
  staffId: z.string().optional().nullable(),
  /** Optional user-picked pitch type (chip row driven by
   *  Machine.supportedPitchTypes). Validated server-side against the
   *  machine's supported list to prevent client tampering. */
  pitchType: z.enum(['ASTRO', 'TURF', 'CEMENT', 'NATURAL']).optional().nullable(),
  /** Optional user-picked ball type (chip row driven by
   *  Machine.supportedBallTypes). Validated server-side. */
  ballType: z.enum(['TENNIS', 'LEATHER', 'MACHINE']).optional().nullable(),
  userId: z.string().optional(),
  paymentMethod: z.enum(['ONLINE', 'CASH']).optional(),
});

const MAX_TX_RETRIES = 3;

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const center = await resolveCurrentCenter(req, user);
    if (!center) {
      return NextResponse.json({ error: 'No center selected' }, { status: 400 });
    }
    if (center.bookingModel !== 'RESOURCE_BASED') {
      return NextResponse.json(
        { error: `Center "${center.name}" does not use the resource-based engine` },
        { status: 400 },
      );
    }

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 });
    }
    const body = parsed.data;

    // CORPORATE_BATCH is admin/super-admin only.
    if (body.category === 'CORPORATE_BATCH') {
      const allowed = user.isSuperAdmin || hasMembershipRole(user, center.id, 'ADMIN');
      if (!allowed) {
        return NextResponse.json(
          { error: 'Corporate batch bookings are admin-only' },
          { status: 403 },
        );
      }
    }

    // Admin can book on behalf of another user.
    const isAdmin = user.role === 'ADMIN' || user.isSuperAdmin;
    const targetUserId = (isAdmin && body.userId) ? body.userId : user.id;
    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, isFreeUser: true, isBlacklisted: true },
    });
    if (!targetUser) return NextResponse.json({ error: 'Target user not found' }, { status: 404 });
    if (targetUser.isBlacklisted) {
      return NextResponse.json({ error: 'Account is blocked' }, { status: 403 });
    }

    const isFreeBooking = !!user.isSuperAdmin || targetUser.isFreeUser;

    // Resolve machine type (if MACHINE category) for price overrides.
    // Also validates that any user-picked pitch/ball is within the
    // admin-configured set for this machine — so client tampering can't
    // sneak in a "Cement" booking on a machine the admin only enabled
    // for "Astro".
    let machineTypeCode: string | null = null;
    if (body.category === 'MACHINE' && body.machineId) {
      const m = await prisma.machine.findUnique({
        where: { id: body.machineId },
        select: {
          centerId: true,
          supportedPitchTypes: true,
          supportedBallTypes: true,
          machineType: { select: { code: true } },
        },
      });
      if (!m || m.centerId !== center.id) {
        return NextResponse.json({ error: 'Machine not found at this center' }, { status: 400 });
      }
      machineTypeCode = m.machineType.code;

      if (body.pitchType && !m.supportedPitchTypes.includes(body.pitchType)) {
        return NextResponse.json(
          { error: `Pitch type "${body.pitchType}" is not available for this machine` },
          { status: 400 },
        );
      }
      if (body.ballType && !m.supportedBallTypes.includes(body.ballType)) {
        return NextResponse.json(
          { error: `Ball type "${body.ballType}" is not available for this machine` },
          { status: 400 },
        );
      }
      // If the admin gave us multiple options, require the user to pick.
      if (m.supportedPitchTypes.length > 1 && !body.pitchType) {
        return NextResponse.json({ error: 'Pitch type is required' }, { status: 400 });
      }
      if (m.supportedBallTypes.length > 1 && !body.ballType) {
        return NextResponse.json({ error: 'Ball type is required' }, { status: 400 });
      }
    }

    // Validate every slot's plan up front (without taking any locks).
    // The actual create runs inside a serializable transaction, which
    // re-checks resource availability under a tighter consistency window.
    const plans = body.slots.map((s) => {
      const startTime = new Date(s.startTime);
      const endTime = new Date(s.endTime);
      const date = dateStringToUTC(s.date);
      return {
        category: body.category as BookingCategory,
        centerId: center.id,
        startTime,
        endTime,
        date,
        resourceIds: body.resourceIds,
        machineId: body.machineId ?? null,
        coachId: body.coachId ?? null,
        staffId: body.staffId ?? null,
      } satisfies BookingPlan;
    });

    // Pre-check (cheap; helps fail fast with a clear message).
    for (const plan of plans) {
      try {
        await planBooking(plan);
      } catch (e) {
        if (e instanceof BookingResourceError) {
          return NextResponse.json({ error: e.message }, { status: e.status });
        }
        throw e;
      }
    }

    // Now create everything atomically. Re-runs under serializable on
    // conflict so concurrent bookings can't both grab the same resource.
    const created: { id: string; status: string }[] = [];

    let lastError: unknown = null;
    for (let attempt = 1; attempt <= MAX_TX_RETRIES; attempt++) {
      try {
        const results = await prisma.$transaction(
          async (tx) => {
            const out: { id: string; status: string }[] = [];
            for (const plan of plans) {
              // Re-plan inside the transaction so we're using the latest
              // occupancy. (planBooking uses prisma directly — for the
              // strict-consistency story we'd want an isolated `tx`-aware
              // version; on the small UAT fleet we expect, the outer
              // serializable + retry loop is sufficient.)
              const assignment = await planBooking(plan);

              const price = isFreeBooking
                ? 0
                : await getResourceSlotPrice({
                    category: plan.category as Exclude<BookingCategory, never>,
                    machineTypeCode,
                    startTime: plan.startTime,
                    centerId: center.id,
                  });

              const booking = await tx.booking.create({
                data: {
                  centerId: center.id,
                  userId: targetUserId,
                  date: plan.date,
                  startTime: plan.startTime,
                  endTime: plan.endTime,
                  status: 'BOOKED',
                  // ballType column on Booking is non-null. For resource
                  // bookings: use the user pick when present; otherwise
                  // fall back to the machine type's default; otherwise
                  // TENNIS (legacy default kept for back-compat).
                  ballType: body.ballType ?? (machineTypeCode === 'YANTRA' || machineTypeCode === 'GRAVITY'
                    ? 'LEATHER'
                    : machineTypeCode === 'LEVERAGE'
                      ? 'TENNIS'
                      : 'TENNIS'),
                  pitchType: body.pitchType ?? null,
                  playerName: body.playerName,
                  category: plan.category,
                  assignedMachineId: assignment.machineId,
                  assignedCoachId: assignment.coachId,
                  assignedStaffId: assignment.staffId,
                  isSuperAdminBooking: !!user.isSuperAdmin,
                  createdBy: user.name || user.id,
                  price: isFreeBooking ? 0 : price,
                  originalPrice: price,
                  paymentMethod: body.paymentMethod ?? null,
                  paymentStatus: isFreeBooking ? 'PAID' : (body.paymentMethod === 'CASH' ? 'PENDING' : 'UNPAID'),
                },
                select: { id: true, status: true },
              });

              await persistResourceAssignments(tx, booking.id, assignment.resourceIds);
              out.push(booking);
            }
            return out;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );

        created.push(...results);
        lastError = null;
        break;
      } catch (e) {
        lastError = e;
        // Retry on serialization failures only.
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          (e.code === 'P2034' || e.code === 'P2002') &&
          attempt < MAX_TX_RETRIES
        ) {
          continue;
        }
        // Non-retriable — surface immediately.
        if (e instanceof BookingResourceError) {
          return NextResponse.json({ error: e.message }, { status: e.status });
        }
        throw e;
      }
    }
    if (lastError) {
      const msg = lastError instanceof Error ? lastError.message : 'Booking failed';
      return NextResponse.json({ error: msg }, { status: 500 });
    }

    return NextResponse.json({ bookings: created, centerId: center.id }, { status: 201 });
  } catch (error) {
    console.error('Resource booking error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
