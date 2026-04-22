import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/adminAuth';

// GET /api/admin/packages/reports - Package analytics & reporting
export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const now = new Date();

    // Auto-expire packages
    await prisma.userPackage.updateMany({
      where: { status: 'ACTIVE', expiryDate: { lt: now } },
      data: { status: 'EXPIRED' },
    });

    const [
      activePackages,
      expiredPackages,
      cancelledPackages,
      allUserPackages,
      packageBookings,
      refundTxns,
      packages,
    ] = await Promise.all([
      prisma.userPackage.count({ where: { status: 'ACTIVE' } }),
      prisma.userPackage.count({ where: { status: 'EXPIRED' } }),
      prisma.userPackage.count({ where: { status: 'CANCELLED' } }),
      prisma.userPackage.findMany({
        select: { id: true, totalSessions: true, usedSessions: true, amountPaid: true, packageId: true, status: true },
      }),
      prisma.packageBooking.findMany({
        select: { extraCharge: true, sessionsUsed: true },
      }),
      // Refunds tied to a userPackage (package cancellations)
      prisma.walletTransaction.findMany({
        where: { type: 'CREDIT_REFUND', referenceId: { not: null } },
        select: { referenceId: true, amount: true },
      }),
      prisma.package.findMany({
        select: { id: true, name: true },
      }),
    ]);

    // Aggregate refunds by userPackageId
    const userPackageIds = new Set(allUserPackages.map(up => up.id));
    const refundByPackage = new Map<string, number>();
    for (const txn of refundTxns) {
      if (!txn.referenceId || !userPackageIds.has(txn.referenceId)) continue;
      refundByPackage.set(txn.referenceId, (refundByPackage.get(txn.referenceId) || 0) + txn.amount);
    }

    // Net revenue per package = amountPaid − refunded (floored at 0)
    const netRevenueForUP = (up: typeof allUserPackages[number]) =>
      Math.max(0, up.amountPaid - (refundByPackage.get(up.id) || 0));

    // Non-cancelled packages count toward "sold"; session metrics cover actual usage across all statuses
    const nonCancelled = allUserPackages.filter(up => up.status !== 'CANCELLED');

    const totalSessionsSold = nonCancelled.reduce((sum, up) => sum + up.totalSessions, 0);
    const totalSessionsConsumed = allUserPackages.reduce((sum, up) => sum + up.usedSessions, 0);
    const totalExtraChargesCollected = packageBookings.reduce((sum, pb) => sum + pb.extraCharge, 0);
    const totalRevenue = allUserPackages.reduce((sum, up) => sum + netRevenueForUP(up), 0);
    const totalRefunded = allUserPackages.reduce(
      (sum, up) => sum + (refundByPackage.get(up.id) || 0),
      0,
    );

    // Revenue per package type (net of refunds, all statuses)
    const packageNameMap = new Map(packages.map(p => [p.id, p.name]));
    const revenueByPackage: Record<string, { revenue: number; sold: number; sessionsUsed: number }> = {};
    for (const up of allUserPackages) {
      const name = packageNameMap.get(up.packageId) || up.packageId;
      if (!revenueByPackage[name]) {
        revenueByPackage[name] = { revenue: 0, sold: 0, sessionsUsed: 0 };
      }
      revenueByPackage[name].revenue += netRevenueForUP(up);
      if (up.status !== 'CANCELLED') revenueByPackage[name].sold += 1;
      revenueByPackage[name].sessionsUsed += up.usedSessions;
    }

    return NextResponse.json({
      activePackages,
      expiredPackages,
      cancelledPackages,
      totalSessionsSold,
      totalSessionsConsumed,
      totalExtraChargesCollected,
      totalRevenue,
      totalRefunded,
      revenueByPackage,
    });
  } catch (error) {
    console.error('Admin package reports error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
