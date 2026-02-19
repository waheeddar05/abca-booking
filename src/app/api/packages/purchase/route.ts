import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';

// POST /api/packages/purchase - Purchase a package
export async function POST(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { packageId, activationDate } = body;

    if (!packageId) {
      return NextResponse.json({ error: 'packageId is required' }, { status: 400 });
    }

    const pkg = await prisma.package.findUnique({ where: { id: packageId } });
    if (!pkg) {
      return NextResponse.json({ error: 'Package not found' }, { status: 404 });
    }
    if (!pkg.isActive) {
      return NextResponse.json({ error: 'Package is not available' }, { status: 400 });
    }

    // Check if user already has this package ACTIVE and with remaining sessions
    const now = new Date();
    const activePackages = await prisma.userPackage.findMany({
      where: {
        userId: user.id,
        packageId: pkg.id,
        status: 'ACTIVE',
        expiryDate: { gte: now },
      },
    });

    const packageWithSessions = activePackages.find(up => up.usedSessions < up.totalSessions);

    if (packageWithSessions) {
      const remaining = packageWithSessions.totalSessions - packageWithSessions.usedSessions;
      return NextResponse.json(
        { error: `You already have an active "${pkg.name}" package with ${remaining} session(s) remaining. You can only purchase it again once all sessions are used.` },
        { status: 400 }
      );
    }

    const activation = activationDate ? new Date(activationDate) : new Date();
    const expiry = new Date(activation);
    expiry.setDate(expiry.getDate() + pkg.validityDays);

    const userPackage = await prisma.userPackage.create({
      data: {
        userId: user.id,
        packageId: pkg.id,
        totalSessions: pkg.totalSessions,
        usedSessions: 0,
        activationDate: activation,
        expiryDate: expiry,
        status: 'ACTIVE',
        amountPaid: pkg.price,
      },
      include: { package: true },
    });

    return NextResponse.json(userPackage, { status: 201 });
  } catch (error) {
    console.error('Package purchase error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
