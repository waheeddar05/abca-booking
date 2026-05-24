/**
 * Package-purchase completion path.
 *
 * Used to live as a private helper inside `/api/payments/verify`, but
 * the Razorpay webhook needs the exact same logic when it wins the
 * claim race for a PACKAGE_PURCHASE payment. The previous "webhook
 * just logs needs_review" branch was the cause of the "Payment
 * captured but booking is still being processed" error: the webhook
 * flipped CREATED→CAPTURED, returned 200, never created the
 * UserPackage, and the user-driven verify call polled for 15s and
 * gave up.
 *
 * Pure helper — no auth, no request object. Caller is responsible
 * for confirming the Payment row is in a state where completion is
 * safe (i.e. signature verified or webhook signature verified).
 */
import { prisma } from '@/lib/prisma';
import { notifyPaymentSuccess } from '@/lib/notifications';
import { debitWallet, isWalletEnabled } from '@/lib/wallet';

export interface CompletePackagePurchaseResult {
  userPackage: Awaited<ReturnType<typeof prisma.userPackage.create>>;
}

/**
 * Idempotent-ish: if the Payment row already has a userPackageId,
 * the caller should not re-invoke this — but if they do, the
 * "already active package with remaining sessions" guard inside
 * still keeps things sane.
 */
export async function completePackagePurchase(
  payment: { id: string; amount: number; metadata: unknown; centerId: string },
  userId: string,
): Promise<CompletePackagePurchaseResult> {
  const meta = payment.metadata as Record<string, unknown> | null;
  const packageId = meta?.packageId as string | undefined;
  const walletDeduction = (meta?.walletDeduction as number) || 0;

  if (!packageId) {
    throw new Error('Package ID missing from payment metadata');
  }

  const pkg = await prisma.package.findUnique({ where: { id: packageId } });
  if (!pkg) throw new Error('Package not found');

  // Reject if the user already has an active row with sessions left.
  // Note: this is a soft check — the source of truth for "did we
  // already complete this payment" is `Payment.userPackageId`, which
  // the caller should check before invoking us. This guard is for
  // double-purchase prevention, not double-fulfilment.
  const activePackages = await prisma.userPackage.findMany({
    where: {
      userId,
      packageId: pkg.id,
      status: 'ACTIVE',
      expiryDate: { gte: new Date() },
    },
  });
  const packageWithSessions = activePackages.find(
    (up) => up.usedSessions < up.totalSessions,
  );
  if (packageWithSessions) {
    throw new Error(
      `Already have an active "${pkg.name}" package with remaining sessions`,
    );
  }

  // Total paid = Razorpay amount + wallet deduction.
  // Validity starts from first booking, not purchase date
  // Set to null as placeholder (will be recalculated on first booking)
  const activation = null;
  const expiry = null;

  const userPackage = await prisma.userPackage.create({
    data: {
      userId,
      packageId: pkg.id,
      totalSessions: pkg.totalSessions,
      usedSessions: 0,
      activationDate: activation,
      expiryDate: expiry,
      status: 'ACTIVE',
      amountPaid: totalAmountPaid,
    },
    include: { package: true },
  });

  // Link payment → user package. The verify route's lost-claim poll
  // watches this field; without it, the polling caller eventually
  // bails with the "still being processed" 202 the user reported.
  await prisma.payment.update({
    where: { id: payment.id },
    data: { userPackageId: userPackage.id },
  });

  // Wallet debit (if any) — soft fail so we don't undo the Razorpay
  // capture just because the wallet ledger had a hiccup.
  if (walletDeduction > 0) {
    try {
      const walletEnabled = await isWalletEnabled(payment.centerId);
      if (walletEnabled) {
        await debitWallet(
          userId,
          payment.centerId,
          walletDeduction,
          'DEBIT_BOOKING',
          `Package purchase: ${pkg.name}`,
          userPackage.id,
        );
      }
    } catch (walletErr) {
      console.error('Wallet debit for package purchase failed:', walletErr);
    }
  }

  // Notification path is fire-and-forget — a slow Twilio / Meta
  // WhatsApp BSP can't be allowed to stall the verify response (the
  // BSP fetch also has a 5s timeout in `src/lib/whatsapp.ts`).
  void (async () => {
    try {
      const notifUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { mobileNumber: true, mobileVerified: true },
      });
      await notifyPaymentSuccess(userId, {
        message: `Your "${pkg.name}" package (${pkg.totalSessions} sessions) is now active. Valid until ${expiry.toLocaleDateString('en-IN')}.`,
        mobileNumber: notifUser?.mobileVerified ? notifUser.mobileNumber : null,
      });
    } catch (notifErr) {
      console.error('Failed to send package purchase notification:', notifErr);
    }
  })();

  return { userPackage };
}
