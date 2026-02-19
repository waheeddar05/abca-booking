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
      packages,
    ] = await Promise.all([
      prisma.userPackage.count({ where: { status: 'ACTIVE' } }),
      prisma.userPackage.count({ where: { status: 'EXPIRED' } }),
      prisma.userPackage.count({ where: { status: 'CANCELLED' } }),
      prisma.userPackage.findMany({
        select: { totalSessions: true, usedSessions: true, amountPaid: true, packageId: true },
      }),
      prisma.packageBooking.findMany({
        select: { extraCharge: true, sessionsUsed: true },
      }),
      prisma.package.findMany({
        select: { id: true, name: true },
      }),
    ]);

    const totalSessionsSold = allUserPackages.reduce((sum, up) => sum + up.totalSessions, 0);
    const totalSessionsConsumed = allUserPackages.reduce((sum, up) => sum + up.usedSessions, 0);
    const totalExtraChargesCollected = packageBookings.reduce((sum, pb) => sum + pb.extraCharge, 0);
    const totalRevenue = allUserPackages.reduce((sum, up) => sum + up.amountPaid, 0);

    // Revenue per package type
    const packageNameMap = new Map(packages.map(p => [p.id, p.name]));
    const revenueByPackage: Record<string, { revenue: number; sold: number; sessionsUsed: number }> = {};
    for (const up of allUserPackages) {
      const name = packageNameMap.get(up.packageId) || up.packageId;
      if (!revenueByPackage[name]) {
        revenueByPackage[name] = { revenue: 0, sold: 0, sessionsUsed: 0 };
      }
      revenueByPackage[name].revenue += up.amountPaid;
      revenueByPackage[name].sold += 1;
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
      revenueByPackage,
    });
  } catch (error) {
    console.error('Admin package reports error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
