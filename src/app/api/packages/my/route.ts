import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';
import { getUserActivePackages } from '@/lib/packages';

// GET /api/packages/my - User's packages dashboard
export async function GET(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const includeAll = searchParams.get('all') === 'true';

    if (includeAll) {
      // Return all packages (active, expired, cancelled)
      const now = new Date();

      // Auto-expire
      await prisma.userPackage.updateMany({
        where: {
          userId: user.id,
          status: 'ACTIVE',
          expiryDate: { lt: now },
        },
        data: { status: 'EXPIRED' },
      });

      const packages = await prisma.userPackage.findMany({
        where: { userId: user.id },
        include: {
          package: true,
          packageBookings: {
            include: { booking: true },
            orderBy: { createdAt: 'desc' },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      const response = NextResponse.json(packages.map(formatUserPackage));
      response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      response.headers.set('Pragma', 'no-cache');
      response.headers.set('Expires', '0');
      return response;
    }

    // Return only active packages
    const activePackages = await getUserActivePackages(user.id);
    
    // Add no-cache headers to ensure the browser always gets the latest data
    const response = NextResponse.json(activePackages.map(formatUserPackage));
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('Expires', '0');
    
    return response;
  } catch (error) {
    console.error('My packages error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

function formatUserPackage(up: any) {
  const remaining = up.totalSessions - up.usedSessions;
  const totalExtraPayments = up.packageBookings?.reduce(
    (sum: number, pb: any) => sum + (pb.extraCharge || 0),
    0
  ) || 0;

  return {
    id: up.id,
    packageName: up.package.name,
    machineType: up.package.machineType,
    ballType: up.package.ballType,
    wicketType: up.package.wicketType,
    timingType: up.package.timingType,
    totalSessions: up.totalSessions,
    usedSessions: up.usedSessions,
    remainingSessions: remaining,
    activationDate: up.activationDate,
    expiryDate: up.expiryDate,
    status: up.status,
    amountPaid: up.amountPaid,
    totalExtraPayments,
    bookingHistory: up.packageBookings?.map((pb: any) => ({
      id: pb.id,
      bookingId: pb.bookingId,
      sessionsUsed: pb.sessionsUsed,
      extraCharge: pb.extraCharge,
      extraChargeType: pb.extraChargeType,
      createdAt: pb.createdAt,
      booking: pb.booking ? {
        date: pb.booking.date,
        startTime: pb.booking.startTime,
        endTime: pb.booking.endTime,
        ballType: pb.booking.ballType,
        pitchType: pb.booking.pitchType,
        status: pb.booking.status,
        playerName: pb.booking.playerName,
      } : null,
    })) || [],
  };
}
