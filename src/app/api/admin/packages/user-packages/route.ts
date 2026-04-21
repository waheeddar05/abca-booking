import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/adminAuth';
import { getAuthenticatedUser } from '@/lib/auth';
import { creditWallet } from '@/lib/wallet';
import { notifyWalletCredit } from '@/lib/notifications';

// GET /api/admin/packages/user-packages?userId=xxx&status=ACTIVE&search=john&packageId=xxx - List user packages
export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');
    const status = searchParams.get('status');
    const search = searchParams.get('search');
    const packageId = searchParams.get('packageId');

    const where: any = {};
    if (userId) where.userId = userId;
    if (status) where.status = status;
    if (packageId) where.packageId = packageId;

    // Search by user name, email, or mobile number
    if (search) {
      where.user = {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { mobileNumber: { contains: search } },
        ],
      };
    }

    const userPackages = await prisma.userPackage.findMany({
      where,
      include: {
        package: true,
        user: { select: { id: true, name: true, mobileNumber: true, email: true } },
        packageBookings: {
          include: { booking: true },
          orderBy: { createdAt: 'desc' },
        },
        auditLogs: { orderBy: { createdAt: 'desc' } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(userPackages);
  } catch (error) {
    console.error('Admin user-packages list error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/admin/packages/user-packages - Admin actions on user packages
// Actions: EXTEND_EXPIRY, ADD_SESSIONS, REDUCE_SESSIONS, RESET_SESSIONS, CANCEL, CONVERT_PACKAGE, OVERRIDE_EXTRA_CHARGES
export async function POST(req: NextRequest) {
  const adminUser = await requireAdmin(req);
  if (!adminUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Get admin user id for audit log
  const authUser = await getAuthenticatedUser(req);
  const adminId = authUser?.id || 'admin';

  try {
    const body = await req.json();
    const { userPackageId, action, ...params } = body;

    if (!userPackageId || !action) {
      return NextResponse.json({ error: 'userPackageId and action are required' }, { status: 400 });
    }

    const userPackage = await prisma.userPackage.findUnique({
      where: { id: userPackageId },
      include: { package: true, user: { select: { id: true, mobileNumber: true } } },
    });

    if (!userPackage) {
      return NextResponse.json({ error: 'User package not found' }, { status: 404 });
    }

    // ─── Special-case CANCEL: pro-rata wallet refund ───────────
    if (action === 'CANCEL') {
      if (userPackage.status === 'CANCELLED') {
        return NextResponse.json({ error: 'Package already cancelled' }, { status: 400 });
      }
      const total = userPackage.totalSessions;
      const used = userPackage.usedSessions;
      const unused = Math.max(0, total - used);
      const perSession = total > 0 ? userPackage.amountPaid / total : 0;
      const refundAmount = Math.round(perSession * unused * 100) / 100;

      let walletTxnId: string | null = null;
      let newBalance: number | null = null;
      if (refundAmount > 0) {
        const res = await creditWallet(
          userPackage.userId,
          refundAmount,
          'CREDIT_REFUND',
          `Pro-rata refund for cancelled package "${userPackage.package.name}" (${unused} of ${total} sessions unused)`,
          userPackageId,
        );
        walletTxnId = res.transactionId;
        newBalance = res.newBalance;
      }

      const [updated] = await prisma.$transaction([
        prisma.userPackage.update({
          where: { id: userPackageId },
          data: { status: 'CANCELLED', usedSessions: total }, // invalidate remaining sessions
          include: { package: true },
        }),
        prisma.packageAuditLog.create({
          data: {
            userPackageId,
            action: 'CANCEL',
            details: {
              previousStatus: userPackage.status,
              totalSessions: total,
              usedSessions: used,
              unusedSessions: unused,
              pricePerSession: perSession,
              refundAmount,
              walletTransactionId: walletTxnId,
              adminId,
            },
            performedBy: adminId,
          },
        }),
      ]);

      if (refundAmount > 0 && newBalance !== null) {
        notifyWalletCredit(userPackage.userId, {
          amount: refundAmount,
          reason: `Package cancelled — ${unused} unused session${unused === 1 ? '' : 's'} refunded`,
          newBalance,
          mobileNumber: userPackage.user?.mobileNumber ?? null,
        }).catch(err => console.warn('[PackageCancel] Wallet notification failed:', err));
      }

      return NextResponse.json({ ...updated, refundAmount, walletTransactionId: walletTxnId });
    }

    let updateData: any = {};
    let auditDetails: any = {};

    switch (action) {
      case 'EXTEND_EXPIRY': {
        const { days } = params;
        if (days === undefined || days === 0) {
          return NextResponse.json({ error: 'days must be a non-zero number' }, { status: 400 });
        }
        const newExpiry = new Date(userPackage.expiryDate);
        newExpiry.setDate(newExpiry.getDate() + days);
        updateData = { expiryDate: newExpiry };
        if (days > 0 && userPackage.status === 'EXPIRED') updateData.status = 'ACTIVE';
        auditDetails = { days, oldExpiry: userPackage.expiryDate, newExpiry };
        break;
      }

      case 'ADD_SESSIONS': {
        const { sessions } = params;
        if (!sessions || sessions <= 0) {
          return NextResponse.json({ error: 'sessions must be a positive number' }, { status: 400 });
        }
        updateData = { totalSessions: userPackage.totalSessions + sessions };
        auditDetails = { sessions, oldTotal: userPackage.totalSessions, newTotal: userPackage.totalSessions + sessions };
        break;
      }

      case 'REDUCE_SESSIONS': {
        const { sessions } = params;
        if (!sessions || sessions <= 0) {
          return NextResponse.json({ error: 'sessions must be a positive number' }, { status: 400 });
        }
        const newTotal = Math.max(userPackage.usedSessions, userPackage.totalSessions - sessions);
        updateData = { totalSessions: newTotal };
        auditDetails = { sessions, oldTotal: userPackage.totalSessions, newTotal };
        break;
      }

      case 'RESET_SESSIONS': {
        updateData = { usedSessions: 0 };
        auditDetails = { oldUsed: userPackage.usedSessions };
        break;
      }

      case 'CONVERT_PACKAGE': {
        const { newPackageId } = params;
        if (!newPackageId) {
          return NextResponse.json({ error: 'newPackageId is required' }, { status: 400 });
        }
        const newPkg = await prisma.package.findUnique({ where: { id: newPackageId } });
        if (!newPkg) {
          return NextResponse.json({ error: 'New package not found' }, { status: 404 });
        }
        updateData = { packageId: newPackageId, totalSessions: newPkg.totalSessions };
        auditDetails = { oldPackageId: userPackage.packageId, newPackageId, oldTotal: userPackage.totalSessions, newTotal: newPkg.totalSessions };
        break;
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    const [updated] = await prisma.$transaction([
      prisma.userPackage.update({
        where: { id: userPackageId },
        data: updateData,
        include: { package: true },
      }),
      prisma.packageAuditLog.create({
        data: {
          userPackageId,
          action,
          details: auditDetails,
          performedBy: adminId,
        },
      }),
    ]);

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Admin user-package action error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
