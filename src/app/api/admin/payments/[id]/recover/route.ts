import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, getAdminSession } from '@/lib/adminAuth';
import { executeSlotBooking } from '@/app/api/slots/book/route';
import { initiateRefund } from '@/lib/razorpay';

/**
 * POST /api/admin/payments/[id]/recover
 *
 * Manual remediation for an "orphaned capture" — a Payment row where
 * Razorpay says CAPTURED but no booking exists. Two modes:
 *
 *   ?action=retry   (default) — re-run executeSlotBooking using the
 *                   bookingPayload stored in payment.metadata. Creates
 *                   the booking the user paid for.
 *   ?action=refund  — issue a Razorpay refund and mark the payment
 *                   REFUNDED. Use when the slot is no longer
 *                   available or the user has moved on.
 *
 * Admin-only. Both paths log the actor for audit.
 */
type Params = { id: string };

export async function POST(req: NextRequest, ctx: { params: Promise<Params> }) {
  try {
    const session = await requireAdmin(req);
    if (!session) {
      return NextResponse.json({ error: 'Admin required' }, { status: 403 });
    }
    const adminSession = await getAdminSession(req);
    const adminLabel = adminSession?.email ?? 'unknown-admin';

    const { id } = await ctx.params;
    const action = (new URL(req.url).searchParams.get('action') ?? 'retry') as 'retry' | 'refund';

    const payment = await prisma.payment.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true, name: true, role: true, email: true,
            isFreeUser: true, isSpecialUser: true, mobileVerified: true,
          },
        },
      },
    });
    if (!payment) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
    }
    if (payment.status === 'REFUNDED') {
      return NextResponse.json({ error: 'Payment already refunded' }, { status: 400 });
    }
    if (payment.status !== 'CAPTURED') {
      return NextResponse.json(
        { error: `Payment status is ${payment.status}, recovery only applies to CAPTURED` },
        { status: 400 },
      );
    }

    if (action === 'refund') {
      if (!payment.razorpayPaymentId) {
        return NextResponse.json({ error: 'No razorpayPaymentId on this payment' }, { status: 400 });
      }
      console.log(`[Recover] admin=${adminLabel} refunding payment ${payment.id}`);
      const refund = await initiateRefund({
        paymentId: payment.razorpayPaymentId,
        amount: payment.amount,
        notes: { recoveredBy: adminLabel, paymentRowId: payment.id },
      });
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'REFUNDED',
          refundId: refund.id ? String(refund.id) : null,
          refundedAt: new Date(),
          metadata: stampRecoveryHandled(payment.metadata, `Refunded by ${adminLabel}`),
        },
      });
      return NextResponse.json({ status: 'refunded', refundId: refund.id ?? null });
    }

    // retry path
    if (payment.paymentType !== 'SLOT_BOOKING') {
      return NextResponse.json(
        { error: 'Retry is only supported for SLOT_BOOKING payments' },
        { status: 400 },
      );
    }
    if (payment.bookingIds.length > 0) {
      return NextResponse.json(
        { error: 'Payment already has bookings — refresh and re-check' },
        { status: 400 },
      );
    }

    const meta = (payment.metadata && typeof payment.metadata === 'object'
      ? payment.metadata
      : {}) as Record<string, unknown>;
    const bookingPayload = meta.bookingPayload as Record<string, unknown>[] | undefined;
    if (!bookingPayload || bookingPayload.length === 0) {
      return NextResponse.json(
        { error: 'No bookingPayload stored on this payment — cannot retry; refund instead.' },
        { status: 400 },
      );
    }

    if (!payment.user) {
      return NextResponse.json({ error: 'Payer user no longer exists' }, { status: 400 });
    }

    console.log(
      `[Recover] admin=${adminLabel} retrying booking for payment ${payment.id} user=${payment.user.id} slots=${bookingPayload.length}`,
    );

    const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || process.env.INITIAL_ADMIN_EMAIL || '';
    const isPayerSuperAdmin = !!(payment.user.email && SUPER_ADMIN_EMAIL && payment.user.email === SUPER_ADMIN_EMAIL);

    const bookings = await executeSlotBooking(
      {
        id: payment.user.id,
        name: payment.user.name || undefined,
        role: payment.user.role,
        email: payment.user.email || undefined,
        isSuperAdmin: isPayerSuperAdmin,
        isFreeUser: payment.user.isFreeUser,
        isSpecialUser: payment.user.isSpecialUser,
        mobileVerified: payment.user.mobileVerified,
      },
      bookingPayload.map((slot) => ({ ...slot, paymentId: payment.id })),
      { onlinePaymentId: payment.id },
    );

    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        metadata: stampRecoveryHandled(payment.metadata, `Booking created by ${adminLabel}`),
      },
    });

    return NextResponse.json({
      status: 'recovered',
      bookingIds: bookings.map((b) => b.id),
    });
  } catch (error) {
    console.error('[admin.payments.recover]', error);
    const message = error instanceof Error ? error.message : 'Recovery failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function stampRecoveryHandled(metadata: unknown, note: string): never {
  const base =
    metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>) : {};
  const recovery =
    base.recovery && typeof base.recovery === 'object'
      ? (base.recovery as Record<string, unknown>)
      : {};
  return {
    ...base,
    recovery: {
      ...recovery,
      handled: true,
      handledAt: new Date().toISOString(),
      handledNote: note,
    },
  } as never;
}
