import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma, type BookingCategory } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';
import { resolveCurrentCenter } from '@/lib/centers';
import {
  planBooking,
  persistResourceAssignments,
  BookingResourceError,
  type BookingPlan,
} from '@/lib/resource-booking';
import { getResourceSlotPrice } from '@/lib/resource-pricing';
import { getAllApplicablePromoDiscounts } from '@/lib/promotionalOffers';
import {
  effectivePitchTypes,
  effectiveBallTypes,
  getSidearmPitchTypes,
  getNetPitchTypes,
} from '@/lib/pitch-config';
import { sanitizeApiError } from '@/lib/api-errors';
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
  category: z.enum(['MACHINE', 'SIDEARM', 'COACHING', 'FULL_COURT', 'CORPORATE_BATCH', 'NET']),
  playerName: z.string().min(1).max(120),
  resourceIds: z.array(z.string()).optional(),
  machineId: z.string().optional().nullable(),
  coachId: z.string().optional().nullable(),
  staffId: z.string().optional().nullable(),
  /** Optional user-picked pitch type (chip row driven by
   *  Machine.supportedPitchTypes). Validated server-side against the
   *  machine's supported list to prevent client tampering. The legacy
   *  'TURF' enum value is no longer accepted on new bookings. */
  pitchType: z.enum(['ASTRO', 'CEMENT', 'NATURAL']).optional().nullable(),
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

    // CORPORATE_BATCH used to be admin-only; it's now bookable by any
    // user (the resource engine auto-claims the configured number of
    // nets, same as it does for the policy-driven virtual reservation).

    // Admin can book on behalf of another user.
    const isAdmin = user.role === 'ADMIN' || user.isSuperAdmin;
    const targetUserId = (isAdmin && body.userId) ? body.userId : user.id;
    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, isFreeUser: true, isSpecialUser: true, isBlacklisted: true },
    });
    if (!targetUser) return NextResponse.json({ error: 'Target user not found' }, { status: 404 });
    if (targetUser.isBlacklisted) {
      return NextResponse.json({ error: 'Account is blocked' }, { status: 403 });
    }

    const isFreeBooking = !!user.isSuperAdmin || targetUser.isFreeUser;
    // Audience for blocked-slot evaluation — promotional offers and
    // BlockedSlot.appliesTo can target SPECIAL users only or exclude
    // them. Default ALL when isSpecialUser is null/false.
    const audience: 'ALL' | 'SPECIAL' | 'NON_SPECIAL' = targetUser.isSpecialUser ? 'SPECIAL' : 'NON_SPECIAL';

    // Resolve machine type (if MACHINE category) for price overrides.
    // Validates picked pitch/ball against the *effective* list (configured
    // values, or the universe when the admin left them empty) so client
    // tampering can't sneak in unsupported types.
    let machineTypeCode: string | null = null;
    if (body.category === 'MACHINE' && body.machineId) {
      const m = await prisma.machine.findUnique({
        where: { id: body.machineId },
        select: {
          centerId: true,
          supportedPitchTypes: true,
          supportedBallTypes: true,
          machineType: { select: { code: true, ballType: true } },
        },
      });
      if (!m || m.centerId !== center.id) {
        return NextResponse.json({ error: 'Machine not found at this center' }, { status: 400 });
      }
      machineTypeCode = m.machineType.code;

      const effPitch = effectivePitchTypes(m.supportedPitchTypes);
      const effBall = effectiveBallTypes(
        m.supportedBallTypes as Array<'TENNIS' | 'LEATHER' | 'MACHINE'>,
        m.machineType.ballType,
      );

      if (body.pitchType && !effPitch.includes(body.pitchType)) {
        return NextResponse.json(
          { error: `Pitch type "${body.pitchType}" is not available for this machine` },
          { status: 400 },
        );
      }
      if (body.ballType && !effBall.includes(body.ballType)) {
        return NextResponse.json(
          { error: `Ball type "${body.ballType}" is not available for this machine` },
          { status: 400 },
        );
      }
      if (effPitch.length > 1 && !body.pitchType) {
        return NextResponse.json({ error: 'Pitch type is required' }, { status: 400 });
      }
      if (effBall.length > 1 && !body.ballType) {
        return NextResponse.json({ error: 'Ball type is required' }, { status: 400 });
      }
    }

    // SIDEARM / NET also accept a pitch type — read from the per-center
    // policy so we can validate the picked value and reject anything not
    // in the allow-list. Required when the policy has more than one type.
    if (body.category === 'SIDEARM' || body.category === 'NET') {
      const allowed =
        body.category === 'SIDEARM'
          ? await getSidearmPitchTypes(center.id)
          : await getNetPitchTypes(center.id);
      if (body.pitchType && !allowed.includes(body.pitchType)) {
        return NextResponse.json(
          {
            error: `Pitch type "${body.pitchType}" is not available for ${body.category.toLowerCase()} bookings at this center`,
          },
          { status: 400 },
        );
      }
      if (allowed.length > 1 && !body.pitchType) {
        return NextResponse.json({ error: 'Pitch type is required' }, { status: 400 });
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
        await planBooking(plan, { audience });
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
              const assignment = await planBooking(plan, { audience });

              const basePrice = isFreeBooking
                ? 0
                : await getResourceSlotPrice({
                    category: plan.category as Exclude<BookingCategory, never>,
                    machineTypeCode,
                    // Specificity in the pricing matrix — pass the user
                    // pick so machinePricing[code][pitch][ball] applies
                    // when configured.
                    pitchType: body.pitchType ?? null,
                    ballType: body.ballType ?? null,
                    startTime: plan.startTime,
                    centerId: center.id,
                  });

              // Apply the best applicable promotional offer. Resource-
              // based bookings can target offers via category +
              // machineRowId in addition to the legacy enum axes.
              let finalPrice = basePrice;
              let discountAmount = 0;
              let appliedOffer: { offerId: string; name: string; discountType: 'PERCENTAGE' | 'FIXED'; discountValue: number } | null = null;
              if (basePrice > 0) {
                const allPromos = await getAllApplicablePromoDiscounts(
                  plan.date,
                  plan.startTime,
                  null, // legacy machineId not used for resource bookings
                  body.pitchType ?? null,
                  audience === 'SPECIAL',
                  assignment.machineId,
                  plan.category,
                  center.id,
                );
                if (allPromos.length > 0) {
                  // Pick the offer that produces the largest absolute
                  // discount on this booking.
                  const computed = allPromos.map((p) => {
                    const d = p.discountType === 'PERCENTAGE'
                      ? Math.min(basePrice, Math.floor((basePrice * p.discountValue) / 100))
                      : Math.min(basePrice, Math.floor(p.discountValue));
                    return { promo: p, d };
                  });
                  computed.sort((a, b) => b.d - a.d);
                  const best = computed[0];
                  if (best && best.d > 0) {
                    discountAmount = best.d;
                    finalPrice = basePrice - best.d;
                    appliedOffer = {
                      offerId: best.promo.offerId,
                      name: best.promo.name,
                      discountType: best.promo.discountType,
                      discountValue: best.promo.discountValue,
                    };
                  }
                }
              }

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
                  price: finalPrice,
                  originalPrice: basePrice,
                  discountAmount: discountAmount > 0 ? discountAmount : null,
                  // discountType uses the same enum as the offer (PERCENTAGE/
                  // FIXED) so reports can render either, mirroring the
                  // legacy MACHINE_PITCH booking flow.
                  discountType: appliedOffer ? appliedOffer.discountType : null,
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
    const { message, status } = sanitizeApiError(
      error,
      'slots.book-resource',
      'Booking failed. Please try again.',
    );
    return NextResponse.json({ error: message }, { status });
  }
}
