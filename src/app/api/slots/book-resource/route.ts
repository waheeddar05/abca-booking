import { NextRequest, NextResponse, after } from 'next/server';
import { z } from 'zod';
import { Prisma, type BookingCategory } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';
import { resolveCurrentCenter } from '@/lib/centers';
import {
  planBooking,
  persistResourceAssignments,
  BookingResourceError,
  getActiveBlocksForSlot,
  evaluateBlockForBooking,
  getCenterGroundStaff,
  pickGroundStaffForSlot,
  type BookingPlan,
} from '@/lib/resource-booking';
import {
  resolveMatchPracticePlans,
  assertMatchPracticeSeat,
  isMatchPracticeCategory,
  type MatchPracticePlan,
} from '@/lib/match-practice';
import { notifyAssignedStaffNewBooking, notifyCustomerNewBooking, notifyAdminPaymentIssue } from '@/lib/notifications';
import { markCaptureNeedsRecovery } from '@/lib/payment-recovery';
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
import { isSlotPaymentRequired } from '@/lib/razorpay';
import { creditWallet, debitWallet, getWalletBalance, isWalletEnabled } from '@/lib/wallet';
import { log } from '@/lib/logger';
import { autoAssignOperator, getOperatorCount } from '@/lib/operatorAssign';
import { getTimeSlab, getTimeSlabConfig } from '@/lib/pricing';
import { getPolicyValue } from '@/lib/policy';
import {
  getCenterRecurringDiscountRules,
  recurringRuleMatches,
  computeRecurringDiscountForSlot,
} from '@/lib/resource-discounts';

/**
 * POST /api/slots/book-resource
 *
 * Resource-based booking creation. Intended for centers with
 * `bookingModel = RESOURCE_BASED`.
 *
 * Body:
 * {
 *   slots: [{ date: 'YYYY-MM-DD', startTime, endTime }],
 *   category: 'MACHINE' | 'SIDEARM' | 'COACHING' | 'FULL_COURT'
 *           | 'CORPORATE_BATCH' | 'NET' | 'MATCH_SIMULATION',
 *   playerName,
 *   resourceIds?: string[],   // optional pin (otherwise engine picks)
 *   machineId?: string,       // for MACHINE
 *   coachId?: string,         // for COACHING
 *   staffId?: string,         // for SIDEARM
 *   corporateMode?: 'MONTHLY' | 'HALF_MONTH' | 'REGULAR', // CORPORATE_BATCH
 *   enrollmentPeriod?: 'YYYY-MM' | 'YYYY-MM-H1' | 'YYYY-MM-H2',
 *   userId?: string,          // admin can book on behalf
 *   paymentMethod?: 'ONLINE' | 'CASH'
 * }
 *
 * Match Practice (CORPORATE_BATCH / MATCH_SIMULATION) bookings are
 * seat-based: capacity + fees come from CORPORATE_BATCH_CONFIG /
 * MATCH_SIMULATION_CONFIG (see src/lib/match-practice.ts) and no
 * machine / pitch / operator / net is involved.
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

export const ResourceBookingBodySchema = z.object({
  slots: z.array(SlotSchema).min(1).max(8),
  category: z.enum(['MACHINE', 'SIDEARM', 'COACHING', 'FULL_COURT', 'CORPORATE_BATCH', 'NET', 'MATCH_SIMULATION']),
  playerName: z.string().min(1).max(120),
  /** Match Practice → Corporate Batch purchase mode. Required for
   *  CORPORATE_BATCH bookings; ignored for every other category.
   *  ADHOC is accepted as a legacy alias for REGULAR so a payment
   *  captured just before the rename still verifies. */
  corporateMode: z.enum(['MONTHLY', 'HALF_MONTH', 'REGULAR', 'ADHOC']).optional().nullable(),
  /** Enrollment period for MONTHLY ("YYYY-MM") / HALF_MONTH
   *  ("YYYY-MM-H1" | "YYYY-MM-H2") corporate-batch bookings. The server
   *  derives the actual session window from this + the center config —
   *  client-sent slot times are ignored for those modes. */
  enrollmentPeriod: z.string().regex(/^\d{4}-\d{2}(-H[12])?$/).optional().nullable(),
  /** Which MATCH_SIMULATION session a MONTHLY / HALF_MONTH enrollment is
   *  for. Required for match-simulation monthly passes; ignored otherwise.
   *  The server re-validates it against MATCH_SIMULATION_CONFIG. */
  matchSimSessionId: z.string().optional().nullable(),
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
  /** Payment mode chosen by the user. ONLINE = Razorpay (the only path
   *  that flows through the verify route); CASH = pay at center, booking
   *  stays paymentStatus=PENDING; WALLET = full wallet deduction, debited
   *  server-side after the bookings are created. */
  paymentMethod: z.enum(['ONLINE', 'CASH', 'WALLET']).optional(),
  /** Wallet balance to deduct on top of the chosen payment method.
   *  - With paymentMethod=WALLET this must equal the booking total.
   *  - With paymentMethod=ONLINE this is the partial wallet credit that
   *    was applied to the Razorpay amount; the server debits it after
   *    the bookings are committed (mirrors the ABCA pattern). */
  walletDeduction: z.number().nonnegative().optional(),
  /** Optional package redemption — when set, the engine validates the
   *  package matches the booking's center/category/machine and uses
   *  one session per booked slot, charging price = 0. Same model as
   *  the legacy MACHINE_PITCH path. */
  userPackageId: z.string().optional(),
  /** Whether the user opted into the per-slot cricket kit rental.
   *  The client-side `kitRentalCharge` is informational only — the
   *  server re-reads `KIT_RENTAL_CONFIG` from the center policy and
   *  uses *that* value to compute the charge, so a tampered client
   *  can't underpay. Mirrors ABCA's /api/slots/book flow. */
  kitRental: z.boolean().optional(),
  kitRentalCharge: z.number().nonnegative().optional(),
  /** User-requested operation mode for MACHINE bookings. Optional —
   *  when omitted the server picks based on operator availability
   *  (existing behaviour). When the user explicitly picks
   *  SELF_OPERATE the server will skip operator assignment even if
   *  one is free. Leather machines always force WITH_OPERATOR
   *  regardless of the request (server enforces). Tennis machines
   *  may legitimately self-operate. Mirrors ABCA's OptionsPanel. */
  operationMode: z.enum(['WITH_OPERATOR', 'SELF_OPERATE']).optional(),
});

export type ResourceBookingBody = z.infer<typeof ResourceBookingBodySchema>;

export interface ResourceBookingResult {
  id: string;
  status: string;
}

export interface ResourceBookingOptions {
  /** When set, attach this Payment to every created booking (mirrors
   *  the legacy executeSlotBooking flow). */
  onlinePaymentId?: string;
}

export class ResourceBookingServiceError extends Error {
  status: number;
  extra?: Record<string, unknown>;
  constructor(message: string, status = 400, extra?: Record<string, unknown>) {
    super(message);
    this.name = 'ResourceBookingServiceError';
    this.status = status;
    this.extra = extra;
  }
}

const MAX_TX_RETRIES = 3;

type AuthedUser = {
  id: string;
  name?: string | null;
  email?: string | null;
  role?: string;
  isSuperAdmin?: boolean;
};

type CenterRef = { id: string; name: string; bookingModel: string };

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

    const parsed = ResourceBookingBodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 });
    }
    const body = parsed.data;

    // Refuse the unpaid path when SLOT_PAYMENT_REQUIRED is on for this
    // center. Online-paid bookings come through /api/payments/verify
    // (which calls executeResourceBooking with an onlinePaymentId) and
    // bypass this guard. Cash, package redemption, super-admin, and
    // free-user bookings are still allowed — same exemption set the
    // ABCA path applies.
    const slotPaymentRequired = await isSlotPaymentRequired(center.id);
    if (slotPaymentRequired) {
      const isCashPath = body.paymentMethod === 'CASH';
      const isWalletPath = body.paymentMethod === 'WALLET';
      const isPackagePath = !!body.userPackageId;
      const isBookerSuperAdmin = !!user.isSuperAdmin;
      if (!isCashPath && !isWalletPath && !isPackagePath && !isBookerSuperAdmin) {
        // Defer to the client: it should have gone through the Razorpay
        // flow. Surface a clear 402 so the UI can prompt re-payment.
        return NextResponse.json(
          { error: 'Online payment is required for this booking. Please complete the payment first.' },
          { status: 402 },
        );
      }
    }

    try {
      const created = await executeResourceBooking(user, body, {
        id: center.id,
        name: center.name,
        bookingModel: center.bookingModel,
      });
      return NextResponse.json({ bookings: created, centerId: center.id }, { status: 201 });
    } catch (e) {
      if (e instanceof ResourceBookingServiceError) {
        return NextResponse.json({ error: e.message, ...(e.extra ?? {}) }, { status: e.status });
      }
      if (e instanceof BookingResourceError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      throw e;
    }
  } catch (error) {
    const { message, status } = sanitizeApiError(
      error,
      'slots.book-resource',
      'Booking failed. Please try again.',
    );
    return NextResponse.json({ error: message }, { status });
  }
}

/**
 * Reusable resource-booking logic. Called by both the public POST handler
 * and `/api/payments/verify` (so that an online-paid resource booking
 * goes through the same atomic transaction).
 *
 * Throws `ResourceBookingServiceError` for validation failures (400/403/…)
 * and `BookingResourceError` for engine-level conflicts. Both carry an
 * HTTP status the caller can surface.
 */
export async function executeResourceBooking(
  user: AuthedUser,
  body: ResourceBookingBody,
  center: CenterRef,
  options: ResourceBookingOptions = {},
): Promise<ResourceBookingResult[]> {
  if (center.bookingModel !== 'RESOURCE_BASED') {
    throw new ResourceBookingServiceError(
      `Center "${center.name}" does not use the resource-based engine`,
      400,
    );
  }

  const onlinePaymentId = options.onlinePaymentId;
  const ctx = {
    op: 'booking.create.resource',
    user: { id: user.id, email: user.email, name: user.name },
    centerId: center.id,
    centerSlug: center.name,
    paymentId: onlinePaymentId ?? null,
    extra: {
      slots: body.slots.length,
      category: body.category,
      machineId: body.machineId ?? null,
      pitchType: body.pitchType ?? null,
      ballType: body.ballType ?? null,
      paymentMethod: body.paymentMethod ?? (onlinePaymentId ? 'ONLINE' : 'NONE'),
      walletDeduction: body.walletDeduction ?? 0,
    },
  } as const;

  log.info(ctx, 'Booking attempt start');

  try {
    let created: ResourceBookingResult[];
    try {
      created = await executeResourceBookingCore(user, body, center, { onlinePaymentId });
    } catch (firstErr) {
      // Auto-retry only captured online bookings; wallet / cash / free pass
      // straight through (retrying those could double-charge a wallet).
      if (!onlinePaymentId) throw firstErr;
      // Never double-book: if the first attempt actually committed + linked
      // bookings before throwing (a post-commit error), use those instead of
      // retrying. Core links payment.bookingIds before any post-commit work,
      // so it's the reliable "did it actually book?" signal.
      const linked = await prisma.payment.findUnique({
        where: { id: onlinePaymentId },
        select: { bookingIds: true },
      });
      if (linked && linked.bookingIds.length > 0) {
        created = await prisma.booking.findMany({
          where: { id: { in: linked.bookingIds } },
          select: { id: true, status: true },
        });
        log.warn(
          { ...ctx, bookingIds: linked.bookingIds },
          'First attempt committed bookings despite throwing — using those, skipping retry',
        );
      } else {
        log.warn(
          ctx,
          `Resource booking failed — retrying once before refund: ${firstErr instanceof Error ? firstErr.message : String(firstErr)}`,
        );
        await new Promise((r) => setTimeout(r, 600));
        created = await executeResourceBookingCore(user, body, center, { onlinePaymentId });
        log.info(ctx, 'Resource booking recovered on retry');
      }
    }
    log.info({ ...ctx, bookingIds: created.map(b => b.id) }, `Booking success — ${created.length} row(s) created`);

    // ─── Notifications (fire-and-forget) ──────────────────────────────
    // 1. Customer confirmation — the resource engine previously skipped
    //    this entirely, so Sidearm / Coaching / Cricket Net / Full Court /
    //    Bowling Machine customers got no confirmation. Now every category
    //    confirms (in-app always, WhatsApp when enabled + verified).
    // 2. Assigned staff — operator / coach / specialist plus the center's
    //    ground staff for floor-handled categories.
    // Neither ever blocks or fails the booking.
    const createdIds = created.map(b => b.id);
    // Use Next after() (not a bare `void`): run these once the response is
    // flushed while keeping the serverless function alive. A plain `void`
    // lets Vercel suspend the lambda the instant we respond, aborting the
    // in-flight WhatsApp BSP fetch with "This operation was aborted".
    after(async () => {
      await notifyCustomerNewBooking(createdIds);
      await notifyAssignedStaffNewBooking(createdIds);
    });

    return created;
  } catch (error) {
    log.error(ctx, 'Booking failed', error);

    // Auto-refund-to-wallet when a Razorpay-captured payment can't be
    // turned into a booking. Mirrors executeSlotBooking's recovery
    // (src/app/api/slots/book/route.ts ~990). Without this, the money
    // is captured and the user sees "no booking created" with no
    // way to get a refund except admin intervention.
    //
    // ── Race-safety check ─────────────────────────────────────────
    // The webhook + verify race can have us land here with bookings
    // already created by the *other* path but `Payment.bookingIds`
    // not yet linked (the post-tx update is still in flight). Poll
    // briefly before refunding so we never refund a booking that
    // actually exists. Without this guard a user could end up with
    // both bookings AND a wallet refund. See the verify route's
    // atomic-claim block for the broader fix.
    if (onlinePaymentId) {
      try {
        const refundDecision = await shouldAutoRefund(onlinePaymentId);
        if (refundDecision.refund) {
          const payment = refundDecision.payment;
          const refundAmount = payment.amount;
          const walletResult = await creditWallet(
            payment.userId,
            payment.centerId,
            refundAmount,
            'CREDIT_REFUND',
            'Auto-refund: resource booking failed after payment',
            onlinePaymentId,
          );
          await prisma.payment.update({
            where: { id: onlinePaymentId },
            data: {
              status: 'REFUNDED',
              refundAmount,
              refundedAt: new Date(),
              refundMethod: 'WALLET',
              failureReason: `Booking failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          });
          log.info(
            { ...ctx, op: 'payment.refund', amount: refundAmount, extra: { ...ctx.extra, refundMethod: 'WALLET', newWalletBalance: walletResult.newBalance } },
            'Auto-refunded to wallet after booking failure',
          );

          // Real-time admin alert so a paid-but-unbooked case is never
          // discovered only via a customer complaint. Best-effort.
          await notifyAdminPaymentIssue({
            paymentId: onlinePaymentId,
            outcome: 'REFUNDED',
            reason: error instanceof Error ? error.message : 'Booking failed',
          }).catch(() => {});

          const errMessage = error instanceof Error ? error.message : 'Booking failed';
          throw new ResourceBookingServiceError(
            `${errMessage}. ₹${refundAmount} has been refunded to your wallet.`,
            error instanceof ResourceBookingServiceError
              ? error.status
              : error instanceof BookingResourceError
                ? error.status
                : 500,
            { refunded: true, refundAmount, walletBalance: walletResult.newBalance },
          );
        }
        if (refundDecision.reason === 'bookings_exist') {
          // The other path created the bookings while we were failing.
          // The user already has a booking — eat the failure silently
          // and pretend success (the verify route's poll will return
          // the bookings to the client).
          log.warn(
            ctx,
            `Booking failure suppressed: bookings already exist on payment (linkedIds=${refundDecision.linkedBookingIds.join(',')})`,
          );
          return refundDecision.linkedBookings;
        }
      } catch (refundErr) {
        if (refundErr instanceof ResourceBookingServiceError) throw refundErr;
        log.error(ctx, 'CRITICAL: auto-refund failed after booking failure', refundErr);
        log.error(ctx, 'Original booking error', error);
        // The wallet auto-refund itself failed (e.g. wallet disabled for the
        // center, or a DB blip). Don't leave the captured payment as a
        // silent, reason-less orphan — flag it so /admin/payments/orphans
        // surfaces it for a manual Razorpay refund or booking retry. This is
        // the resource-path equivalent of the verify route's recovery flag,
        // and (unlike before) also covers the webhook caller.
        await markCaptureNeedsRecovery(
          onlinePaymentId,
          `Booking failed and wallet auto-refund failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ).catch((e) => log.error(ctx, 'Failed to flag capture for recovery after refund failure', e));
        // Worst case — money captured, no booking, no refund. Page the admins
        // immediately so it never sits silently.
        await notifyAdminPaymentIssue({
          paymentId: onlinePaymentId,
          outcome: 'NEEDS_ATTENTION',
          reason: `Booking failed AND wallet auto-refund failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        }).catch(() => {});
      }
    }

    throw error;
  }
}

/**
 * Defensive helper for the auto-refund branch.
 *
 * Returns:
 *   - `{ refund: true, payment }` when the payment is genuinely orphaned
 *     (CAPTURED + no bookings linked + no concurrent path to wait for).
 *   - `{ refund: false, reason: 'bookings_exist', linkedBookings, linkedBookingIds }`
 *     when bookings appeared during the poll — we MUST NOT refund.
 *   - `{ refund: false, reason: ... }` for every other terminal state.
 *
 * Polls `Payment.bookingIds` for up to 8s with 400ms intervals. The
 * caller decides what to do with each outcome.
 */
async function shouldAutoRefund(paymentId: string): Promise<
  | { refund: true; payment: { id: string; userId: string; centerId: string; amount: number } }
  | { refund: false; reason: 'bookings_exist'; linkedBookings: ResourceBookingResult[]; linkedBookingIds: string[] }
  | { refund: false; reason: 'not_captured' | 'already_refunded' | 'gone' }
> {
  const MAX_POLL_MS = 8_000;
  const POLL_INTERVAL_MS = 400;
  const deadline = Date.now() + MAX_POLL_MS;
  let payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  while (
    payment
    && payment.status === 'CAPTURED'
    && payment.bookingIds.length === 0
    && Date.now() < deadline
  ) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  }
  if (!payment) return { refund: false, reason: 'gone' };
  if (payment.status === 'REFUNDED') return { refund: false, reason: 'already_refunded' };
  if (payment.status !== 'CAPTURED') return { refund: false, reason: 'not_captured' };
  if (payment.bookingIds.length > 0) {
    const linkedBookings = await prisma.booking.findMany({
      where: { id: { in: payment.bookingIds } },
      select: { id: true, status: true },
    });
    return {
      refund: false,
      reason: 'bookings_exist',
      linkedBookings,
      linkedBookingIds: payment.bookingIds,
    };
  }
  return {
    refund: true,
    payment: {
      id: payment.id,
      userId: payment.userId,
      centerId: payment.centerId,
      amount: payment.amount,
    },
  };
}

async function executeResourceBookingCore(
  user: AuthedUser,
  body: ResourceBookingBody,
  center: CenterRef,
  options: { onlinePaymentId?: string },
): Promise<ResourceBookingResult[]> {
  const onlinePaymentId = options.onlinePaymentId;

  // Match Practice categories (CORPORATE_BATCH enrollments + MATCH_
  // SIMULATION sessions) are SEAT-based: capacity comes from the center
  // config, no machine / pitch / operator / net is claimed, and pricing
  // is a flat per-mode fee. They share this function's payment / wallet /
  // refund machinery but skip the resource-planning pipeline entirely.
  const isMatchPractice = isMatchPracticeCategory(body.category);

  // Admin can book on behalf of another user.
  const isAdmin = user.role === 'ADMIN' || user.isSuperAdmin;
  const targetUserId = (isAdmin && body.userId) ? body.userId : user.id;
  const targetUser = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, isFreeUser: true, isSpecialUser: true, isBlacklisted: true },
  });
  if (!targetUser) throw new ResourceBookingServiceError('Target user not found', 404);
  if (targetUser.isBlacklisted) {
    throw new ResourceBookingServiceError('Account is blocked', 403);
  }

  const isFreeBooking = !!user.isSuperAdmin || targetUser.isFreeUser;
  // Audience for blocked-slot evaluation — promotional offers and
  // BlockedSlot.appliesTo can target SPECIAL users only or exclude
  // them. Default ALL when isSpecialUser is null/false.
  const audience: 'ALL' | 'SPECIAL' | 'NON_SPECIAL' = targetUser.isSpecialUser ? 'SPECIAL' : 'NON_SPECIAL';

  // Payment-mode shortcuts. WALLET = wallet covers the full amount,
  // debited after the booking transaction commits (mirrors the ABCA
  // MACHINE_PITCH wallet flow). CASH = booking is created with
  // paymentStatus=PENDING. ONLINE comes here only via the verify route
  // (onlinePaymentId is set).
  const isWalletPayment = body.paymentMethod === 'WALLET';
  const isCashPayment = body.paymentMethod === 'CASH';
  const walletDeductionRequest = Math.max(0, Math.floor(body.walletDeduction ?? 0));

  // Pre-check wallet balance up-front so we fail BEFORE we create any
  // bookings (the alternative would be a half-paid booking we then have
  // to roll back). Skipped for free bookings + package redemptions.
  if ((isWalletPayment || walletDeductionRequest > 0) && !isFreeBooking && !body.userPackageId) {
    const walletEnabled = await isWalletEnabled(center.id);
    if (!walletEnabled) {
      throw new ResourceBookingServiceError('Wallet payments are not enabled at this center', 400);
    }
    const balance = await getWalletBalance(targetUserId, center.id);
    if (balance < walletDeductionRequest && isWalletPayment) {
      throw new ResourceBookingServiceError(
        `Insufficient wallet balance. Available: ₹${balance}`,
        400,
      );
    }
  }

  // Resolve machine type (if MACHINE category) for price overrides.
  // Validates picked pitch/ball against the *effective* list (configured
  // values, or the universe when the admin left them empty) so client
  // tampering can't sneak in unsupported types.
  let machineTypeCode: string | null = null;
  // `machineTypeBallType` (TENNIS / LEATHER / MACHINE) drives the
  // operator-required vs self-operate gate below. Sourced from the
  // MachineType.ballType column — the authoritative semantic. Tying the
  // gate to the code string (LEVERAGE / YANTRA / GRAVITY) would silently
  // miss any future machine type added with a different code.
  let machineTypeBallType: string | null = null;
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
      throw new ResourceBookingServiceError('Machine not found at this center', 400);
    }
    machineTypeCode = m.machineType.code;
    machineTypeBallType = m.machineType.ballType;

    const effPitch = effectivePitchTypes(m.supportedPitchTypes);
    const effBall = effectiveBallTypes(
      m.supportedBallTypes as Array<'TENNIS' | 'LEATHER' | 'MACHINE'>,
      m.machineType.ballType,
    );

    if (body.pitchType && !effPitch.includes(body.pitchType)) {
      throw new ResourceBookingServiceError(
        `Pitch type "${body.pitchType}" is not available for this machine`,
        400,
      );
    }
    if (body.ballType && !effBall.includes(body.ballType)) {
      throw new ResourceBookingServiceError(
        `Ball type "${body.ballType}" is not available for this machine`,
        400,
      );
    }
    if (effPitch.length > 1 && !body.pitchType) {
      throw new ResourceBookingServiceError('Pitch type is required', 400);
    }
    if (effBall.length > 1 && !body.ballType) {
      throw new ResourceBookingServiceError('Ball type is required', 400);
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
      throw new ResourceBookingServiceError(
        `Pitch type "${body.pitchType}" is not available for ${body.category.toLowerCase()} bookings at this center`,
        400,
      );
    }
    if (allowed.length > 1 && !body.pitchType) {
      throw new ResourceBookingServiceError('Pitch type is required', 400);
    }
  }

  // Package redemption pre-flight. Loads the user's package, ensures
  // it's at this center, active, has enough remaining sessions, and
  // matches the booking's category + machine row (if pinned). All
  // failures here surface a clear 400 to the client; the actual
  // session decrement happens inside the transaction below.
  // Match-practice bookings are flat-fee seat purchases — package
  // sessions, kit rental, and the machine/pitch pipeline don't apply.
  if (isMatchPractice && body.userPackageId) {
    throw new ResourceBookingServiceError(
      'Packages cannot be redeemed for match practice bookings',
      400,
    );
  }
  let userPackage: {
    id: string;
    totalSessions: number;
    usedSessions: number;
    package: {
      id: string;
      centerId: string;
      category: BookingCategory | null;
      machineRowId: string | null;
      timingType: string;
      // Ball-type the package covers (MACHINE / LEATHER / BOTH).
      // Drives the per-slot ball-type upgrade charge: a MACHINE-only
      // package booking a LEATHER slot pays `ballTypeUpgrade` per slot.
      ballType: string | null;
      // Wicket-type the package covers (ASTRO / CEMENT / NATURAL /
      // BOTH). Drives the per-slot wicket-upgrade charge: a package
      // pinned to ASTRO booking on CEMENT pays the
      // `wicketTypeUpgrades.ASTRO_TO_CEMENT` fee per slot.
      wicketType: string | null;
      extraChargeRules: unknown;
      validityDays: number;
      // Ball-type category of the package's pinned machine (LEATHER /
      // TENNIS / MACHINE). Used to gate cross-machine redemption to
      // same-ball-type machines (e.g. a Yantra package -> Gravity).
      pinnedMachineBallType: string | null;
    };
  } | null = null;
  if (body.userPackageId) {
    const found = await prisma.userPackage.findUnique({
      where: { id: body.userPackageId },
      select: {
        id: true,
        userId: true,
        status: true,
        expiryDate: true,
        totalSessions: true,
        usedSessions: true,
        package: {
          select: {
            id: true,
            centerId: true,
            category: true,
            machineRowId: true,
            // Pinned machine's ball-type category — gates cross-machine
            // redemption (a leather package can only cross to another
            // leather machine, never to a tennis one).
            machineRow: { select: { machineType: { select: { ballType: true } } } },
            timingType: true,
            // `ballType` drives the machine-ball → leather-ball upgrade
            // charge. Null on legacy ABCA-style packages that don't
            // discriminate (the admin form sets it to BOTH for any
            // Toplay package that covers either ball type).
            ballType: true,
            // `wicketType` drives the pitch upgrade charge (Astro →
            // Cement → Natural). Null when the package covers any
            // pitch ("Any wicket" in the admin form).
            wicketType: true,
            // `extraChargeRules` carries the per-package upgrade
            // pricing (timingUpgrade, ballTypeUpgrade,
            // wicketTypeUpgrades, etc.). Needed here so the per-slot
            // extra charge math below sees the same numbers the user
            // saw when they selected the package on the slot grid.
            extraChargeRules: true,
            validityDays: true,
            isActive: true,
          },
        },
      },
    });
    if (!found) {
      throw new ResourceBookingServiceError('Package not found', 400);
    }
    if (found.userId !== targetUserId) {
      throw new ResourceBookingServiceError('Package does not belong to this user', 403);
    }
    if (found.status !== 'ACTIVE') {
      throw new ResourceBookingServiceError('Package is not active', 400);
    }
    if (found.expiryDate && found.expiryDate < new Date()) {
      throw new ResourceBookingServiceError('Package has expired', 400);
    }
    if (found.package.centerId !== center.id) {
      throw new ResourceBookingServiceError('Package belongs to a different center', 400);
    }
    if (!found.package.isActive) {
      throw new ResourceBookingServiceError('Package is no longer available', 400);
    }
    const remaining = found.totalSessions - found.usedSessions;
    if (remaining < body.slots.length) {
      throw new ResourceBookingServiceError(
        `Package has ${remaining} session(s) left; trying to book ${body.slots.length}`,
        400,
      );
    }
    // Category gate — only if the package has one set. ABCA-shape
    // packages with category=null redeem against any category for
    // back-compat.
    if (found.package.category && found.package.category !== body.category) {
      throw new ResourceBookingServiceError(
        `This package only redeems for ${found.package.category} bookings`,
        400,
      );
    }
    // Machine row gate — only if pinned. A package pinned to one machine
    // may be redeemed on that machine OR on another machine of the SAME
    // ball type (a per-direction surcharge from `machineUpgrades` is
    // applied below). Cross-ball-type redemption (e.g. a leather package
    // on a tennis machine) stays blocked.
    const pinnedMachineBallType = found.package.machineRow?.machineType?.ballType ?? null;
    if (found.package.machineRowId && body.machineId !== found.package.machineRowId) {
      const sameBallType =
        body.category === 'MACHINE'
        && !!body.machineId
        && !!pinnedMachineBallType
        && !!machineTypeBallType
        && (pinnedMachineBallType === 'TENNIS') === (machineTypeBallType === 'TENNIS');
      if (!sameBallType) {
        throw new ResourceBookingServiceError(
          'This package can only be redeemed on its machine or another machine of the same ball type',
          400,
        );
      }
    }
    userPackage = {
      id: found.id,
      totalSessions: found.totalSessions,
      usedSessions: found.usedSessions,
      package: {
        id: found.package.id,
        centerId: found.package.centerId,
        category: found.package.category,
        machineRowId: found.package.machineRowId,
        timingType: found.package.timingType,
        ballType: found.package.ballType,
        wicketType: found.package.wicketType,
        extraChargeRules: found.package.extraChargeRules,
        validityDays: found.package.validityDays,
        pinnedMachineBallType,
      },
    };
  }

  // Validate every slot's plan up front (without taking any locks).
  // The actual create runs inside a serializable transaction, which
  // re-checks resource availability under a tighter consistency window.
  //
  // Match-practice categories resolve through their own planner: the
  // server derives the real session windows from the center config
  // (client times are only trusted as a session selector) and the
  // capacity / duplicate checks re-run inside the transaction below.
  let plans: BookingPlan[] = [];
  let mpPlans: MatchPracticePlan[] = [];
  if (isMatchPractice) {
    mpPlans = await resolveMatchPracticePlans(center.id, {
      category: body.category as 'CORPORATE_BATCH' | 'MATCH_SIMULATION',
      // Legacy alias: payments captured before the Ad-hoc → Regular
      // rename carry corporateMode=ADHOC in their stored payload.
      corporateMode: body.corporateMode === 'ADHOC' ? 'REGULAR' : (body.corporateMode ?? null),
      enrollmentPeriod: body.enrollmentPeriod ?? null,
      matchSimSessionId: body.matchSimSessionId ?? null,
      slots: body.slots,
    });
    // Fail-fast block check — an admin block targeting the category (or
    // a catchall) refuses the seat before any payment-side work.
    // MONTHLY / HALF_MONTH enrollments are exempt: they buy a month-long
    // membership, not one session, so a block on a single date (the
    // derived "starts on" session) must not reject the enrollment —
    // blocked dates simply aren't playable for anyone that day.
    for (const p of mpPlans) {
      if (p.mode === 'MONTHLY' || p.mode === 'HALF_MONTH') continue;
      const blocks = await getActiveBlocksForSlot(center.id, {
        date: p.date,
        startTime: p.startTime,
        endTime: p.endTime,
      });
      const reason = evaluateBlockForBooking(
        blocks,
        { category: p.category, resourceIds: [] },
        audience,
      );
      if (reason) throw new BookingResourceError(reason, 409);
    }
  } else {
    plans = body.slots.map((s) => {
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
        // pickNetFor uses this to steer the booking onto the right
        // pool (NET / CEMENT_WICKET / TURF_WICKET). Without it the
        // engine falls back to the indoor-net default — which is what
        // we want for category=COACHING/FULL_COURT where the user
        // doesn't pick a pitch.
        pitchType: body.pitchType ?? null,
      } satisfies BookingPlan;
    });

    // Pre-check (cheap; helps fail fast with a clear message).
    for (const plan of plans) {
      await planBooking(plan, { audience });
    }
  }

  // Default ground-staff contact for match-practice sessions — same
  // assignment rule facility bookings (NET / FULL_COURT) use inside
  // planBooking. Fetched once; picked per session window below.
  const mpGroundStaff = isMatchPractice ? await getCenterGroundStaff(center.id) : [];

  // Resolve the center's time-slab config once (CenterPolicy → default).
  // Needed for operator scheduling on MACHINE bookings to mirror ABCA's
  // morning/evening operator schedule semantics.
  const timeSlabConfig = await getTimeSlabConfig(center.id, true);

  // ─── Kit rental ──────────────────────────────────────────────────
  // The client sends `kitRental: true` when the user ticked the box.
  // The `kitRentalCharge` they send is informational — we re-read the
  // center policy on the server so a tampered client can't underpay.
  // RESOURCE_BASED centers store per-Machine-row config in
  // `KIT_RENTAL_CONFIG.machineRowConfigs`; we use the row override
  // when present, fall back to the global price otherwise.
  const kitRentalRequested = !!body.kitRental && !isMatchPractice;
  let kitRental = false;
  let kitRentalChargePerSlot = 0;
  if (kitRentalRequested) {
    const kitRentalRaw = await getPolicyValue('KIT_RENTAL_CONFIG', center.id, null);
    const kitConfig = kitRentalRaw
      ? (() => { try { return JSON.parse(kitRentalRaw); } catch { return null; } })()
      : null;
    if (kitConfig?.enabled) {
      // Resolve per-machine override → row config price → global price.
      // The booking's machine is `body.machineId` (the user's pick).
      // When the row has an explicit override AND it's disabled, the
      // server rejects kit rental for this booking — the client should
      // have hidden the checkbox; this is just belt-and-braces.
      const rowConfig = body.machineId
        ? (kitConfig.machineRowConfigs ?? {})[body.machineId] as
            | { enabled?: boolean; price?: number }
            | undefined
        : undefined;
      // Disabled-by-row → don't charge.
      if (rowConfig && rowConfig.enabled === false) {
        kitRental = false;
      } else {
        kitRental = true;
        const price = rowConfig?.price ?? kitConfig?.price ?? 200;
        kitRentalChargePerSlot = Math.max(0, Math.floor(price));
      }
    }
  }

  // Recurring slot discounts for this center. Fetched once and matched
  // per-slot inside the tx — same shape ABCA uses, but matched on the
  // resource axes (categories + machineRowIds). Match-practice fees are
  // flat admin-set amounts — recurring/promo discounts don't apply.
  const recurringRules = isMatchPractice ? [] : await getCenterRecurringDiscountRules(center.id);

    // Detect consecutive slot chains. ABCA's pricing config has a
    // separate `consecutive` price for back-to-back slot pairs;
    // resource centers use the same convention via the new
    // `machineRowPricing[…].morning.consecutive` field. A plan is
    // considered "in a consecutive chain" when at least one other
    // plan in the same booking starts exactly when this one ends or
    // ends exactly when this one starts.
    const planIsConsecutive: boolean[] = plans.map((p, i) => {
      return plans.some((q, j) => {
        if (i === j) return false;
        return (
          p.startTime.getTime() === q.endTime.getTime() ||
          p.endTime.getTime() === q.startTime.getTime()
        );
      });
    });

    // Now create everything atomically. Re-runs under serializable on
    // conflict so concurrent bookings can't both grab the same resource.
    const created: { id: string; status: string }[] = [];

    let lastError: unknown = null;
    for (let attempt = 1; attempt <= MAX_TX_RETRIES; attempt++) {
      try {
        const results = await prisma.$transaction(
          async (tx) => {
            const out: { id: string; status: string }[] = [];
            const txPlanCount = isMatchPractice ? mpPlans.length : plans.length;
            for (let i = 0; i < txPlanCount; i++) {
              // ─── Match Practice: seat-based creation ─────────────
              // Capacity + one-seat-per-user re-checked INSIDE the
              // serializable tx so two concurrent submits for the last
              // seat conflict — the loser retries via the outer P2034
              // handler and lands on a clean "session full" rejection.
              if (isMatchPractice) {
                const mp = mpPlans[i];
                await assertMatchPracticeSeat(tx, center.id, targetUserId, mp);
                const groundStaffId = pickGroundStaffForSlot(mpGroundStaff, {
                  date: mp.date,
                  startTime: mp.startTime,
                  endTime: mp.endTime,
                });
                const booking = await tx.booking.create({
                  data: {
                    centerId: center.id,
                    userId: targetUserId,
                    date: mp.date,
                    startTime: mp.startTime,
                    endTime: mp.endTime,
                    status: 'BOOKED',
                    playerName: body.playerName,
                    category: mp.category,
                    corporateBatchMode: mp.mode,
                    enrollmentPeriod: mp.enrollmentPeriod,
                    matchSimSessionId: mp.matchSimSessionId,
                    assignedGroundStaffId: groundStaffId,
                    isSuperAdminBooking: !!user.isSuperAdmin,
                    createdBy: user.name || user.id,
                    // Flat admin-configured fee — no slab/discount math.
                    price: isFreeBooking ? 0 : mp.fee,
                    originalPrice: mp.fee,
                    paymentMethod: onlinePaymentId
                      ? 'ONLINE'
                      : (body.paymentMethod ?? null),
                    paymentStatus: onlinePaymentId
                      ? 'PAID'
                      : (isFreeBooking
                          ? 'PAID'
                          : isWalletPayment
                            ? 'PAID'
                            : isCashPayment
                              ? 'PENDING'
                              : 'UNPAID'),
                  },
                  select: { id: true, status: true },
                });
                out.push(booking);
                continue;
              }

              const plan = plans[i];
              const isConsecutive = planIsConsecutive[i];
              // Operator-availability pre-check for MACHINE bookings.
              // Leather (and any future operator-mandatory) machines
              // can't be booked when the admin marked operators
              // unavailable for the window (operatorCount === 0) or
              // every scheduled operator is already booked. Tennis
              // machines self-operate, so they're not gated here.
              // Passed into planBooking so the engine has a single
              // place to reject the booking — the operator-assignment
              // cascade further down still runs to actually pick the
              // assigned operator + record the operationMode.
              let planOperatorRequired = false;
              let planOperatorAvailable = true;
              if (plan.category === 'MACHINE') {
                // ballType comes from the picked Machine.machineType
                // resolved earlier (`machineTypeBallType`). LEATHER (and
                // anything that isn't TENNIS) requires an operator.
                planOperatorRequired = machineTypeBallType !== 'TENNIS';
                if (planOperatorRequired) {
                  const opCount = await getOperatorCount(
                    plan.date,
                    plan.startTime,
                    timeSlabConfig,
                    center.id,
                  );
                  if (opCount === 0) {
                    planOperatorAvailable = false;
                  } else {
                    // Count DISTINCT operators, not bookings. Two rows
                    // can name the same operator (the last-resort
                    // fallback in autoAssignOperator double-books the
                    // top-priority one), and counting rows would then
                    // retire a seat that nobody is actually occupying.
                    const busyOperators = await tx.booking.findMany({
                      where: {
                        centerId: center.id,
                        date: plan.date,
                        startTime: plan.startTime,
                        status: 'BOOKED',
                        operatorId: { not: null },
                      },
                      select: { operatorId: true },
                      distinct: ['operatorId'],
                    });
                    planOperatorAvailable = busyOperators.length < opCount;
                  }
                }
              }

              // Re-plan inside the transaction. CRITICAL: pass `tx` so
              // the occupancy SELECT participates in this transaction's
              // read set. Without it, two concurrent submits both see
              // the machine as free at the same instant, both pass
              // planBooking, and both insert a Booking — producing the
              // duplicate rows reported by users (4 bookings for 2
              // intended slots). With `tx`, the SELECT triggers
              // serialization conflict detection and the loser gets
              // retried by the outer P2034 handler.
              const assignment = await planBooking(plan, {
                audience,
                tx,
                operator: { required: planOperatorRequired, available: planOperatorAvailable },
              });

              const isPackageRedemption = !!userPackage;

              // Per-slot package extra charge — mirrors ABCA's
              // `validatePackageBooking` flow but inlined so we don't
              // round-trip to /api/packages/validate-booking from
              // inside the transaction. Three axes apply to Toplay
              // packages:
              //   - timing: DAY package booking an evening slot
              //   - ballType: machine-ball package booking leather
              //   - wicketType: pitch upgrade (Astro → Cement → Natural)
              // ABCA-shape packages fall through with the same set via
              // the validate-booking endpoint; this inline math mirrors
              // it 1:1 so the user sees the same total at booking
              // commit as they did in the validation panel.
              let packageExtra = 0;
              // Component breakdown so the persisted PackageBooking records
              // both the amount AND a human-readable extraChargeType (machine >
              // ball > wicket > timing priority, mirroring packages.ts).
              let timingExtra = 0;
              let ballTypeExtra = 0;
              let wicketTypeExtra = 0;
              let machineExtra = 0;
              if (isPackageRedemption && userPackage) {
                const slab = getTimeSlab(plan.startTime, timeSlabConfig);
                const rules = (userPackage.package.extraChargeRules || {}) as {
                  timingUpgrade?: number;
                  ballTypeUpgrade?: number;
                  wicketTypeUpgrades?: Record<string, number>;
                  machineUpgrades?: Record<string, number>;
                };
                // DAY package, evening slot → upgrade charge.
                if (userPackage.package.timingType === 'DAY' && slab === 'evening') {
                  timingExtra = Math.max(0, Math.floor(rules.timingUpgrade ?? 0));
                }
                // Machine-ball package, leather-ball booking → upgrade.
                if (
                  plan.category === 'MACHINE'
                  && userPackage.package.ballType === 'MACHINE'
                  && body.ballType === 'LEATHER'
                ) {
                  ballTypeExtra = Math.max(0, Math.floor(rules.ballTypeUpgrade ?? 0));
                }
                // Wicket-type upgrade — per-path map from the admin
                // form. ASTRO < CEMENT < NATURAL. A package pinned to
                // ASTRO booking on NATURAL would pay the
                // `ASTRO_TO_NATURAL` fee; same shape ABCA writes.
                const wicketUsing =
                  plan.category === 'MACHINE'
                  || plan.category === 'SIDEARM'
                  || plan.category === 'NET';
                if (
                  wicketUsing
                  && userPackage.package.wicketType
                  && userPackage.package.wicketType !== 'BOTH'
                  && body.pitchType
                  && userPackage.package.wicketType !== body.pitchType
                ) {
                  const pathKey = `${userPackage.package.wicketType}_TO_${body.pitchType}`;
                  const pathFee = rules.wicketTypeUpgrades?.[pathKey];
                  if (typeof pathFee === 'number' && pathFee > 0) {
                    wicketTypeExtra = Math.floor(pathFee);
                  }
                }
                // Machine upgrade — package pinned to one machine row,
                // redeemed on a different (same-ball-type) machine. Keyed
                // by Machine row id (`<pinned>_TO_<booked>`), matching the
                // admin form and validatePackageBooking. 0 / missing = no
                // charge (cross-machine still allowed by the gate above).
                if (
                  plan.category === 'MACHINE'
                  && userPackage.package.machineRowId
                  && body.machineId
                  && userPackage.package.machineRowId !== body.machineId
                ) {
                  const mKey = `${userPackage.package.machineRowId}_TO_${body.machineId}`;
                  const mFee = rules.machineUpgrades?.[mKey];
                  if (typeof mFee === 'number' && mFee > 0) {
                    machineExtra = Math.floor(mFee);
                  }
                }
                packageExtra = timingExtra + ballTypeExtra + wicketTypeExtra + machineExtra;
              }
              const packageExtraType: string | null =
                machineExtra > 0 ? 'MACHINE'
                  : ballTypeExtra > 0 ? 'BALL_TYPE'
                    : wicketTypeExtra > 0 ? 'WICKET_TYPE'
                      : timingExtra > 0 ? 'TIMING'
                        : null;

              const basePrice = isFreeBooking
                ? 0
                : isPackageRedemption
                  ? packageExtra
                  : await getResourceSlotPrice({
                      // Match-practice categories never reach this branch
                      // (dispatched above), so the narrowing cast is safe.
                      category: plan.category as Exclude<BookingCategory, 'MATCH_SIMULATION'>,
                      machineTypeCode,
                      // Most-specific override axis: per-Machine-row
                      // pricing (e.g. "Yantra 1" priced separately from
                      // "Yantra 2" at the same center).
                      machineRowId: assignment.machineId ?? null,
                      // Specificity in the pricing matrix — pass the user
                      // pick so machinePricing[code][pitch][ball] applies
                      // when configured.
                      pitchType: body.pitchType ?? null,
                      ballType: body.ballType ?? null,
                      isConsecutive,
                      startTime: plan.startTime,
                      centerId: center.id,
                    });

              // ── Recurring slot discount ──────────────────────────────
              // Apply on top of basePrice (before promotional offers) so
              // promo % discounts compute against the post-recurring price,
              // matching ABCA's order of operations. Only for paid
              // bookings — free/package redemptions already short-circuit
              // basePrice to 0.
              let priceAfterRecurring = basePrice;
              let recurringDiscount = 0;
              let recurringLabel: string | null = null;
              if (basePrice > 0 && recurringRules.length > 0) {
                const matched = recurringRules.filter((rule) =>
                  recurringRuleMatches({
                    rule,
                    startTime: plan.startTime,
                    category: plan.category,
                    machineRowId: assignment.machineId ?? null,
                  }),
                );
                const summary = computeRecurringDiscountForSlot({
                  matches: matched,
                  isConsecutive,
                  isSpecialUser: audience === 'SPECIAL',
                });
                if (summary.total > 0) {
                  recurringDiscount = Math.min(summary.total, basePrice);
                  priceAfterRecurring = Math.max(0, basePrice - recurringDiscount);
                  recurringLabel = summary.label;
                }
              }

              // Apply the best applicable promotional offer. Resource-
              // based bookings can target offers via category +
              // machineRowId in addition to the legacy enum axes.
              let finalPrice = priceAfterRecurring;
              let discountAmount = recurringDiscount;
              let appliedOffer: { offerId: string; name: string; discountType: 'PERCENTAGE' | 'FIXED'; discountValue: number } | null = null;
              // Keep `recurringLabel` referenced even when no promo runs —
              // it ends up in the booking's discount note via the catch-
              // all below when no promo wins.
              void recurringLabel;
              if (priceAfterRecurring > 0) {
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
                  // discount. Computed against priceAfterRecurring so
                  // the promo stacks ON TOP of any recurring discount,
                  // matching ABCA's order of operations.
                  const computed = allPromos.map((p) => {
                    const d = p.discountType === 'PERCENTAGE'
                      ? Math.min(priceAfterRecurring, Math.floor((priceAfterRecurring * p.discountValue) / 100))
                      : Math.min(priceAfterRecurring, Math.floor(p.discountValue));
                    return { promo: p, d };
                  });
                  computed.sort((a, b) => b.d - a.d);
                  const best = computed[0];
                  if (best && best.d > 0) {
                    // discountAmount already carries recurringDiscount;
                    // promo stacks on top.
                    discountAmount = recurringDiscount + best.d;
                    finalPrice = Math.max(0, priceAfterRecurring - best.d);
                    appliedOffer = {
                      offerId: best.promo.offerId,
                      name: best.promo.name,
                      discountType: best.promo.discountType,
                      discountValue: best.promo.discountValue,
                    };
                  }
                }
              }

              // ── Kit rental ─────────────────────────────────────────────
              // Kit rental sits on top of the (possibly discounted) price.
              // It's never discounted itself — matches ABCA's
              // `slotKitCharge` treatment in /api/slots/book.
              const slotKitCharge = kitRental ? kitRentalChargePerSlot : 0;
              if (slotKitCharge > 0) {
                finalPrice += slotKitCharge;
              }

              // ─── Operator auto-assignment (MACHINE category only) ───
              // Mirrors ABCA's WITH_OPERATOR booking flow:
              //   - Read center's operator count (per day/slab).
              //   - If 0 → self-operate slot, no assignment.
              //   - Else check live availability: fail with 409 if every
              //     operator is already booked at this date+startTime.
              //   - Pick the highest-priority free operator via
              //     autoAssignOperator (falls back to highest-priority
              //     even when all are busy, matching ABCA semantics).
              // SIDEARM/COACHING/FULL_COURT skip this — those categories
              // already pin a specific staff/coach via assignedStaffId /
              // assignedCoachId, or need no operator at all.
              let assignedOperatorId: string | null = null;
              let operationMode: 'WITH_OPERATOR' | 'SELF_OPERATE' = 'WITH_OPERATOR';
              if (plan.category === 'MACHINE') {
                // Tennis machines don't strictly need an operator — the
                // user can run the machine themselves. This mirrors
                // ABCA's logic in /api/slots/available:360-377, where
                // tennis machines fall back to SELF_OPERATE when all
                // operators are busy. Leather machines (Yantra / Gravity)
                // still hard-require an operator. Gate on ballType
                // (TENNIS / LEATHER) instead of the code string so the
                // check survives future machine types being added with
                // arbitrary codes.
                const isTennisMachine = machineTypeBallType === 'TENNIS';

                // User-picked SELF_OPERATE: honour it for tennis
                // machines only — bypass operator lookup entirely and
                // record the booking without an assigned operator.
                // Leather machines ignore the request because the
                // machine literally needs someone to load balls.
                if (body.operationMode === 'SELF_OPERATE' && isTennisMachine) {
                  operationMode = 'SELF_OPERATE';
                  assignedOperatorId = null;
                  // Skip the rest of the operator-assignment cascade
                  // below by jumping straight to booking creation.
                  // (Falling through would re-derive operationMode
                  // from operator availability and clobber the
                  // explicit pick.)
                } else {

                const operatorCount = await getOperatorCount(
                  plan.date,
                  plan.startTime,
                  timeSlabConfig,
                  center.id,
                );
                if (operatorCount === 0) {
                  // No operators scheduled: leather can't be booked at all,
                  // tennis falls back to self-operate.
                  if (!isTennisMachine) {
                    throw new BookingResourceError(
                      `No operator scheduled for this slot, and ${machineTypeCode ?? 'this'} machine requires one.`,
                      409,
                    );
                  }
                  operationMode = 'SELF_OPERATE';
                } else {
                  // DISTINCT operators — see the note on the pre-check
                  // above. Counting booking rows retired an operator
                  // seat per booking even when the same person covered
                  // two of them, which is what left later bookings in
                  // a busy slot with `operatorId = null`.
                  const operatorBookings = await tx.booking.findMany({
                    where: {
                      centerId: center.id,
                      date: plan.date,
                      startTime: plan.startTime,
                      status: 'BOOKED',
                      operatorId: { not: null },
                    },
                    select: { operatorId: true },
                    distinct: ['operatorId'],
                  });
                  if (operatorBookings.length >= operatorCount) {
                    // All operators busy. Tennis machine: graceful self-
                    // operate fallback (this is what ABCA does). Leather
                    // machine: hard fail — admin needs to either schedule
                    // more operators or the user picks a different slot.
                    if (!isTennisMachine) {
                      throw new BookingResourceError(
                        `Operator not available for slot at ${plan.startTime.toISOString()}. All ${operatorCount} operator(s) are already booked.`,
                        409,
                      );
                    }
                    operationMode = 'SELF_OPERATE';
                  } else {
                    const slab = getTimeSlab(plan.startTime, timeSlabConfig);
                    assignedOperatorId = await autoAssignOperator(
                      plan.date,
                      plan.startTime,
                      tx,
                      null, // resource-based bookings don't use the legacy enum machineId
                      slab,
                      center.id,
                      // …they identify the machine by row id instead, so
                      // the admin's per-machine operator assignments
                      // (and their weekday `days` filter) actually apply.
                      assignment.machineId,
                    );
                    // autoAssignOperator falls back to highest-priority
                    // operator even when all are busy. If that fallback
                    // returned no one (no operators configured at this
                    // center at all), treat as self-operate for tennis,
                    // hard fail for leather.
                    if (!assignedOperatorId) {
                      if (!isTennisMachine) {
                        throw new BookingResourceError(
                          'No operator could be assigned for this slot.',
                          409,
                        );
                      }
                      operationMode = 'SELF_OPERATE';
                    }
                  }
                }
                } // end else (user did NOT pick SELF_OPERATE)
              }

              const booking = await tx.booking.create({
                data: {
                  centerId: center.id,
                  userId: targetUserId,
                  date: plan.date,
                  startTime: plan.startTime,
                  endTime: plan.endTime,
                  status: 'BOOKED',
                  operatorId: assignedOperatorId,
                  operationMode,
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
                  assignedGroundStaffId: assignment.groundStaffId,
                  isSuperAdminBooking: !!user.isSuperAdmin,
                  createdBy: user.name || user.id,
                  price: finalPrice,
                  originalPrice: basePrice,
                  discountAmount: discountAmount > 0 ? discountAmount : null,
                  // Kit rental — persist on every booking so the row's
                  // `price` (which includes the kit charge) can be
                  // decomposed for refunds, exports, and admin views.
                  kitRental: kitRental,
                  kitRentalCharge: kitRental ? kitRentalChargePerSlot : null,
                  // discountType uses the same enum as the offer (PERCENTAGE/
                  // FIXED) so reports can render either, mirroring the
                  // legacy MACHINE_PITCH booking flow. Recurring-only
                  // discounts (no promo) are labelled FIXED to match
                  // ABCA's convention in book/route.ts.
                  discountType: appliedOffer
                    ? appliedOffer.discountType
                    : (recurringDiscount > 0 ? 'FIXED' : null),
                  paymentMethod: onlinePaymentId
                    ? 'ONLINE'
                    : (body.paymentMethod ?? null),
                  paymentStatus: onlinePaymentId
                    ? 'PAID'
                    : (isFreeBooking
                        ? 'PAID'
                        // Package redemption: user paid for the package at
                        // purchase time, this booking just consumes one
                        // session. Mark PAID so the bookings list /
                        // reports don't show an outstanding balance.
                        : isPackageRedemption
                          ? 'PAID'
                          : isWalletPayment
                            ? 'PAID'
                            : isCashPayment
                              ? 'PENDING'
                              : 'UNPAID'),
                },
                select: { id: true, status: true },
              });

              await persistResourceAssignments(tx, booking.id, assignment.resourceIds);

              // Package redemption — atomically decrement the user
              // package and link the booking via PackageBooking. We
              // re-read inside the transaction so concurrent redemptions
              // can't both spend the same session. Optimistic update
              // with a `where` on the prior usedSessions catches the
              // race; serializable isolation on the outer tx adds a
              // second guard.
              if (userPackage) {
                const fresh = await tx.userPackage.findUnique({
                  where: { id: userPackage.id },
                  select: { usedSessions: true, totalSessions: true, status: true, expiryDate: true },
                });
                if (!fresh) {
                  throw new BookingResourceError('Package not found mid-transaction', 409);
                }
                if (fresh.status !== 'ACTIVE') {
                  throw new BookingResourceError('Package became inactive mid-transaction', 409);
                }
                if (fresh.expiryDate && fresh.expiryDate < new Date()) {
                  throw new BookingResourceError('Package expired mid-transaction', 409);
                }
                if (fresh.usedSessions >= fresh.totalSessions) {
                  throw new BookingResourceError('Package has no sessions left', 409);
                }

                const newUsed = fresh.usedSessions + 1;
                const updateData: any = { usedSessions: newUsed };

                // If first booking, activate validity period
                if (fresh.usedSessions === 0) {
                  const now = new Date();
                  const expiry = new Date(now);
                  expiry.setDate(expiry.getDate() + (userPackage.package?.validityDays || 0));
                  expiry.setHours(23, 59, 59, 999);
                  updateData.activationDate = now;
                  updateData.expiryDate = expiry;
                }

                const updateRes = await tx.userPackage.updateMany({
                  where: { id: userPackage.id, usedSessions: fresh.usedSessions },
                  data: updateData,
                });
                // Note: status stays ACTIVE even when usedSessions ===
                // totalSessions (matches the legacy MACHINE_PITCH path).
                // The "no sessions left" check above stops further
                // redemption; the UI uses `usedSessions / totalSessions`
                // to badge a package as fully spent.
                if (updateRes.count !== 1) {
                  throw new BookingResourceError('Package was modified by another booking; please retry', 409);
                }
                await tx.packageBooking.create({
                  data: {
                    userPackageId: userPackage.id,
                    bookingId: booking.id,
                    sessionsUsed: 1,
                    // Persist the per-session upgrade charge (and its kind) so
                    // exports, package reports, and the "Booking Price" column
                    // reflect what the user actually paid on top of the package.
                    // Previously this was left at the schema default 0, which
                    // silently dropped package upgrade revenue from those
                    // surfaces even though it was collected in Booking.price.
                    extraCharge: packageExtra,
                    extraChargeType: packageExtraType,
                  },
                });
              }

              out.push(booking);
            }
            return out;
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            // FULL_COURT with multiple slots writes 1 Booking + N resource
            // assignments (one per indoor net) + optional package row per
            // slot. Prisma's default 5s tx timeout is too tight: a 4-slot
            // FULL_COURT booking on Toplay was observed taking ~7.3s and
            // failing with P2028 ("Transaction not found"). Give it
            // generous headroom — the serializable isolation already
            // protects against concurrent grabs.
            maxWait: 10_000,
            // Accelerate caps interactive transactions at 15_000ms; staying
            // at/under that avoids P6005 in production (Prisma Postgres).
            timeout: 15_000,
          },
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
      // Non-retriable — surface immediately. BookingResourceError carries
      // its own status; let it bubble for the POST handler / verify route
      // to map.
      throw e;
    }
  }
  if (lastError) {
    if (lastError instanceof BookingResourceError) throw lastError;
    const msg = lastError instanceof Error ? lastError.message : 'Booking failed';
    throw new ResourceBookingServiceError(msg, 500);
  }

  // Link the online Payment row to the created bookings so refund and
  // recovery flows can find them. Mirrors executeSlotBooking's post-tx
  // linkage (src/app/api/slots/book/route.ts ~963).
  if (onlinePaymentId && created.length > 0) {
    try {
      const bookingIds = created.map(b => b.id);
      await prisma.payment.update({
        where: { id: onlinePaymentId },
        data: { bookingIds },
      });
    } catch (linkErr) {
      console.error('Failed to link resource bookings to payment', onlinePaymentId, linkErr);
    }
  }

  // Wallet debit — runs *after* the bookings are committed so a wallet
  // failure can roll back the bookings to keep balances honest. Two
  // entry points trigger this:
  //   1. paymentMethod=WALLET with no Razorpay — debit the full booking
  //      total from wallet.
  //   2. Partial wallet credit applied alongside ONLINE — `onlinePaymentId`
  //      is set and `body.walletDeduction` carries the wallet portion.
  if (!isFreeBooking && !body.userPackageId && created.length > 0) {
    // The actual price total per booking row isn't returned from the tx
    // (we only select id+status). For the wallet-only path, re-read the
    // bookings to compute the exact total to debit.
    let walletToDebit = 0;
    if (isWalletPayment) {
      const priceRows = await prisma.booking.findMany({
        where: { id: { in: created.map(b => b.id) } },
        select: { price: true },
      });
      walletToDebit = priceRows.reduce((sum, r) => sum + (r.price ?? 0), 0);
    } else if (walletDeductionRequest > 0) {
      // Partial wallet credit alongside online/cash payment — debit the
      // requested amount (it was already validated against balance up
      // top of this function).
      walletToDebit = walletDeductionRequest;
    }

    if (walletToDebit > 0) {
      try {
        await debitWallet(
          targetUserId,
          center.id,
          walletToDebit,
          'DEBIT_BOOKING',
          `Booking payment (${created.length} slot${created.length === 1 ? '' : 's'})`,
          created[0].id,
        );
      } catch (walletErr) {
        console.error('Wallet debit after resource booking failed, rolling back:', walletErr);
        // Cancel the bookings we just created so the wallet ledger stays
        // consistent with what the user actually got.
        try {
          await prisma.booking.updateMany({
            where: { id: { in: created.map(b => b.id) } },
            data: {
              status: 'CANCELLED',
              cancelledBy: 'System',
              cancellationReason: 'Wallet payment failed',
            },
          });
        } catch (rollbackErr) {
          console.error('Failed to cancel resource bookings after wallet failure:', rollbackErr);
        }
        const msg = walletErr instanceof Error ? walletErr.message : 'Wallet payment failed';
        throw new ResourceBookingServiceError(msg, 400);
      }
    }
  }

  return created;
}
