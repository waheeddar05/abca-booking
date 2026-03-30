import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/adminAuth';
import { getAuthenticatedUser } from '@/lib/auth';

// POST /api/admin/packages/assign - Assign a custom package to a user
export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const authUser = await getAuthenticatedUser(req);
  const adminId = authUser?.id || 'admin';

  try {
    const body = await req.json();
    const {
      userId,
      name,
      machineId,
      machineType,
      ballType,
      wicketType,
      timingType,
      totalSessions,
      validityDays = 30,
    } = body;

    if (!userId || !name || !machineType || !timingType || !totalSessions || !validityDays) {
      return NextResponse.json(
        { error: 'Missing required fields: userId, name, machineType, timingType, totalSessions, validityDays' },
        { status: 400 }
      );
    }

    if (!['LEATHER', 'TENNIS'].includes(machineType)) {
      return NextResponse.json({ error: 'Invalid machineType' }, { status: 400 });
    }
    if (!['DAY', 'EVENING', 'BOTH'].includes(timingType)) {
      return NextResponse.json({ error: 'Invalid timingType' }, { status: 400 });
    }
    if (ballType && !['MACHINE', 'LEATHER', 'BOTH'].includes(ballType)) {
      return NextResponse.json({ error: 'Invalid ballType' }, { status: 400 });
    }
    if (wicketType && !['CEMENT', 'ASTRO', 'NATURAL', 'BOTH'].includes(wicketType)) {
      return NextResponse.json({ error: 'Invalid wicketType' }, { status: 400 });
    }

    // Verify user exists
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Far-future placeholder dates (recalculated on first booking)
    const farFuture = new Date('2099-12-31T23:59:59.999Z');

    const result = await prisma.$transaction(async (tx) => {
      // Create the custom package template
      const pkg = await tx.package.create({
        data: {
          name,
          machineId: machineId || null,
          machineType,
          ballType: ballType || null,
          wicketType: wicketType || null,
          timingType,
          totalSessions,
          validityDays,
          price: 0,
          isCustom: true,
          isActive: true,
        },
      });

      // Assign to user
      const userPackage = await tx.userPackage.create({
        data: {
          userId,
          packageId: pkg.id,
          totalSessions,
          usedSessions: 0,
          activationDate: farFuture,
          expiryDate: farFuture,
          status: 'ACTIVE',
          amountPaid: 0,
        },
        include: {
          package: true,
          user: { select: { id: true, name: true, mobileNumber: true, email: true } },
        },
      });

      // Audit log
      await tx.packageAuditLog.create({
        data: {
          userPackageId: userPackage.id,
          action: 'ASSIGN_CUSTOM',
          details: {
            packageName: name,
            machineType,
            machineId: machineId || null,
            ballType: ballType || null,
            wicketType: wicketType || null,
            timingType,
            totalSessions,
            validityDays,
            assignedTo: userId,
            assignedByName: authUser?.name || 'admin',
          },
          performedBy: adminId,
        },
      });

      return userPackage;
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error('Admin assign custom package error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
