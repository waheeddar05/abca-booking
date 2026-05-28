import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';
import { debitWallet, isWalletEnabled, getWalletBalance } from '@/lib/wallet';

// POST /api/packages/purchase - Purchase a package
export async function POST(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { packageId, paymentMethod, walletDeduction } = body;

    console.log('Package purchase request body:', body);

    if (!packageId) {
      return NextResponse.json({ error: 'packageId is required' }, { status: 400 });
    }

    const pkg = await prisma.package.findUnique({ where: { id: packageId } });
    if (!pkg) {
      console.log('Package not found:', packageId);
      return NextResponse.json({ error: 'Package not found' }, { status: 404 });
    }
    if (!pkg.isActive) {
      console.log('Package not active:', packageId);
      return NextResponse.json({ error: 'Package is not available' }, { status: 400 });
    }

    // Check if user already has this package ACTIVE and with remaining sessions
    const now = new Date();
    const activePackages = await prisma.userPackage.findMany({
      where: {
        userId: user.id,
        packageId: pkg.id,
        status: 'ACTIVE',
        OR: [
          { expiryDate: null },
          { expiryDate: { gte: now } },
        ],
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

    console.log(`Creating UserPackage for user ${user.id}, package ${pkg.id}`);
    const userPackage = await prisma.userPackage.create({
      data: {
        userId: user.id,
        packageId: pkg.id,
        totalSessions: pkg.totalSessions,
        usedSessions: 0,
        activationDate: null,
        expiryDate: null,
        status: 'ACTIVE',
        amountPaid: pkg.price,
        createdAt: now,
      },
      include: { package: true },
    });
    console.log('UserPackage created:', userPackage.id);

    // Handle wallet payment if requested. Wallets are center-scoped, so
    // we use the package's own center (Package.centerId) — purchasing a
    // Toplay package debits a Toplay wallet, ABCA package debits ABCA.
    if (paymentMethod === 'WALLET' && walletDeduction && walletDeduction > 0) {
      console.log(`Processing wallet deduction: ${walletDeduction} for center ${pkg.centerId}`);
      try {
        const walletEnabled = await isWalletEnabled(pkg.centerId);
        if (!walletEnabled) {
          console.log('Wallet not enabled for center:', pkg.centerId);
          // Rollback
          await prisma.userPackage.delete({ where: { id: userPackage.id } });
          return NextResponse.json({ error: 'Wallet is not enabled' }, { status: 400 });
        }

        const balance = await getWalletBalance(user.id, pkg.centerId);
        if (balance < walletDeduction) {
          console.log(`Insufficient wallet balance. Balance: ${balance}, Required: ${walletDeduction}`);
          // Rollback
          await prisma.userPackage.delete({ where: { id: userPackage.id } });
          return NextResponse.json({ error: 'Insufficient wallet balance' }, { status: 400 });
        }

        await debitWallet(
          user.id,
          pkg.centerId,
          walletDeduction,
          'DEBIT_BOOKING',
          `Package purchase: ${pkg.name}`,
          userPackage.id,
        );
        console.log('Wallet deduction successful');
      } catch (err) {
        console.error('Wallet payment flow failed:', err);
        // Attempt rollback if package still exists
        try {
          await prisma.userPackage.delete({ where: { id: userPackage.id } });
          console.log('Successfully rolled back UserPackage creation after wallet flow failure');
        } catch (rollbackErr) {
          // It might already be deleted in one of the blocks above
          console.log('Note: UserPackage rollback during catch may have already been handled');
        }
        const msg = err instanceof Error ? err.message : 'Wallet payment failed';
        return NextResponse.json({ error: msg }, { status: 400 });
      }
    }

    return NextResponse.json(userPackage, { status: 201 });
    } catch (err) {
    console.error('Outer package purchase error:', err);
    let errorMessage = 'Internal server error';
    let status = 500;

    if (err instanceof Error) {
      errorMessage = err.message;
      // If it's a Prisma error, we might want to be more specific or hide details
      if (err.message.includes('Prisma')) {
        console.error('Prisma specific error:', err);
      }
    }

    return NextResponse.json({ error: errorMessage }, { status });
  }
}
