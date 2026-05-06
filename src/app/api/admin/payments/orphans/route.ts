import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSuperAdmin } from '@/lib/adminAuth';
import { sanitizeApiError } from '@/lib/api-errors';

/**
 * GET /api/admin/payments/orphans
 *
 * Lists "orphaned captures" — Payment rows where Razorpay has confirmed
 * the money is in (status=CAPTURED) but no booking landed (bookingIds
 * empty) for SLOT_BOOKING type. These are the rows that turn into a
 * "user paid but no booking" support ticket.
 *
 * Strictly super-admin only — surfaces every center's payments. The
 * recovery endpoint at /api/admin/payments/[id]/recover does the actual
 * remediation (retry booking creation from stored metadata, or
 * initiate refund if the slot is no longer bookable).
 *
 * Response includes flagged-recovery metadata when present so the
 * admin UI can show why each row failed (e.g. "Verify called but
 * bookingPayload missing").
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireSuperAdmin(req);
    if (!session) {
      return NextResponse.json({ error: 'Super admin required' }, { status: 403 });
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
        center: { select: { id: true, slug: true, name: true } },
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
        center: p.center,
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
    const { message, status } = sanitizeApiError(
      error,
      'admin.payments.orphans',
      'Could not list orphaned payments.',
    );
    return NextResponse.json({ error: message }, { status });
  }
}
