import { prisma } from '@/lib/prisma';

/**
 * Stamp the Payment row's metadata with a `recovery` block (and mirror the
 * reason into `failureReason`) so the `/api/admin/payments/orphans` endpoint
 * can find it. We do NOT change `status` — Razorpay considers the payment
 * good, the booking is just missing. The orphan tool walks
 * `status=CAPTURED` AND `bookingIds=[]` AND `paymentType=SLOT_BOOKING`.
 *
 * Shared by the client-driven verify route and the resource booking engine
 * (both run after a Razorpay capture) so a captured payment is never left as
 * a silent, reason-less orphan when its booking — or its wallet auto-refund —
 * fails.
 */
export async function markCaptureNeedsRecovery(paymentId: string, reason: string): Promise<void> {
  const existing = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { metadata: true },
  });
  const meta =
    existing && typeof existing.metadata === 'object' && existing.metadata !== null
      ? (existing.metadata as Record<string, unknown>)
      : {};
  await prisma.payment.update({
    where: { id: paymentId },
    data: {
      metadata: {
        ...meta,
        recovery: {
          flaggedAt: new Date().toISOString(),
          reason,
          handled: false,
        },
      } as never,
      failureReason: reason,
    },
  });
}
