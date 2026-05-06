import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/adminAuth';

/**
 * GET /api/admin/payments/orphans
 *
 * Lists "orphaned captures" — Payment rows where Razorpay has confirmed
 * the money is in (status=CAPTURED) but no booking landed (bookingIds
 * empty) for SLOT_BOOKING type. These are the rows that turn into a
 * "user paid but no booking" support ticket.
 *
 * Each row carries any `metadata.recovery` block stamped by the verify
 * route, plus a `hasBookingPayload` flag that tells the recovery UI
 * whether Retry is feasible (vs. only a Refund).
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireAdmin(req);
    if (!session) {
      return NextResponse.json({ error: 'Admin required' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const sinceParam = searchParams.get('since'); // ISO date, optional
    const since = sinceParam ? new Date(sinceParam) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const orphans = await prisma.payment.findMany({
      where: {
        status: 'CAPTURED',
        paymentType: 'SLOT_BOOKING',
        bookingIds: { isEmpty: true },
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        user: { select: { id: true, name: true, email: true, mobileNumber: true } },
      },
    });

    const rows = orphans.map((p) => {
      const meta = (p.metadata && typeof p.metadata === 'object' ? p.metadata : {}) as Record<string, unknown>;
      const recovery = (meta.recovery && typeof meta.recovery === 'object' ? meta.recovery : null) as
        | { flaggedAt?: string; reason?: string; handled?: boolean }
        | null;
      const bookingPayload = meta.bookingPayload as unknown[] | undefined;
      return {
        id: p.id,
        createdAt: p.createdAt,
        amount: p.amount,
        currency: p.currency,
        razorpayOrderId: p.razorpayOrderId,
        razorpayPaymentId: p.razorpayPaymentId,
        user: p.user,
        failureReason: p.failureReason,
        recovery,
        hasBookingPayload: Array.isArray(bookingPayload) && bookingPayload.length > 0,
        slotsRequested: Array.isArray(bookingPayload) ? bookingPayload.length : 0,
      };
    });

    return NextResponse.json({
      since: since.toISOString(),
      count: rows.length,
      rows,
    });
  } catch (error) {
    console.error('[admin.payments.orphans]', error);
    const message = error instanceof Error ? error.message : 'Failed to list orphaned payments';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
