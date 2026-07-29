import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/adminAuth';
import { getAuthenticatedUser } from '@/lib/auth';
import { resolveCurrentCenter } from '@/lib/centers';
import {
  packageCategoryLabel,
  categoryUsesBallType,
  PACKAGE_BALL_LABEL,
} from '@/lib/package-admin-labels';

// GET /api/admin/packages/reports/csv - Download user packages as CSV (current center)
export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status'); // ACTIVE, EXPIRED, CANCELLED
    const packageId = searchParams.get('packageId');
    const userId = searchParams.get('userId');
    const fromDate = searchParams.get('fromDate');
    const toDate = searchParams.get('toDate');
    const allCenters = searchParams.get('allCenters') === 'true';

    const adminUser = await getAuthenticatedUser(req);
    const center = adminUser ? await resolveCurrentCenter(req, adminUser) : null;
    let centerId: string | null = null;
    if (!allCenters && center) {
      centerId = center.id;
    } else if (!allCenters && !center) {
      return NextResponse.json({ error: 'No center selected' }, { status: 400 });
    } else if (allCenters && !adminUser?.isSuperAdmin) {
      return NextResponse.json({ error: 'allCenters requires super admin' }, { status: 403 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};
    if (centerId) where.package = { centerId };
    if (status) where.status = status;
    if (packageId) where.packageId = packageId;
    if (userId) where.userId = userId;
    // Scope by PURCHASE date (createdAt), IST-shifted — same basis as the
    // Packages report summary and the admin dashboard, so the exported rows
    // reconcile with the on-screen Total Revenue. (Was activationDate.)
    if (fromDate || toDate) {
      const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
      where.createdAt = {} as { gte?: Date; lt?: Date };
      if (fromDate) where.createdAt.gte = new Date(new Date(fromDate).getTime() - IST_OFFSET_MS);
      if (toDate) where.createdAt.lt = new Date(new Date(toDate).getTime() + 24 * 60 * 60 * 1000 - IST_OFFSET_MS);
    }

    const userPackages = await prisma.userPackage.findMany({
      where,
      include: {
        user: { select: { name: true, email: true, mobileNumber: true } },
        package: {
          select: {
            name: true,
            machineType: true,
            totalSessions: true,
            // `category` discriminates Bowling Machine / Cricket Nets /
            // Sidearm / Personal Coaching / Full Indoor Court /
            // Corporate Batch / Match Simulation. Legacy ABCA rows have
            // null here — `packageCategoryLabel` falls back to "Bowling
            // Machine" for those.
            category: true,
            // `ballType` is only meaningful for Bowling Machine
            // packages; the CSV prints "Not Applicable" otherwise.
            ballType: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Fetch refund transactions keyed by userPackageId
    const userPackageIds = userPackages.map(up => up.id);
    const refundTxns = userPackageIds.length > 0
      ? await prisma.walletTransaction.findMany({
          where: {
            type: 'CREDIT_REFUND',
            referenceId: { in: userPackageIds },
          },
          select: { referenceId: true, amount: true },
        })
      : [];
    const refundByPackage = new Map<string, number>();
    for (const txn of refundTxns) {
      if (!txn.referenceId) continue;
      refundByPackage.set(txn.referenceId, (refundByPackage.get(txn.referenceId) || 0) + txn.amount);
    }

    // Fetch captured payments per UserPackage so we can split wallet vs
    // online for each row. Payment.userPackageId points at the package
    // directly; metadata.walletDeduction (if present) is the wallet
    // portion of a mixed-fund purchase, and Payment.amount is what
    // Razorpay actually captured.
    const payments = userPackageIds.length > 0
      ? await prisma.payment.findMany({
          where: {
            status: 'CAPTURED',
            userPackageId: { in: userPackageIds },
          },
          select: { userPackageId: true, amount: true, metadata: true },
        })
      : [];
    const paymentByUserPackage = new Map<string, typeof payments[number]>();
    for (const p of payments) {
      if (p.userPackageId) paymentByUserPackage.set(p.userPackageId, p);
    }

    // Wallet-only purchases skip the Payment table entirely (see
    // /api/packages/purchase WALLET branch) — the only record of the
    // debit is a WalletTransaction with referenceId=userPackage.id.
    // Capture those debits so wallet-only rows still show a non-zero
    // Wallet Amount column.
    const walletDebits = userPackageIds.length > 0
      ? await prisma.walletTransaction.findMany({
          where: {
            type: 'DEBIT_BOOKING',
            referenceId: { in: userPackageIds },
          },
          select: { referenceId: true, amount: true },
        })
      : [];
    const walletDebitByPackage = new Map<string, number>();
    for (const txn of walletDebits) {
      if (!txn.referenceId) continue;
      walletDebitByPackage.set(
        txn.referenceId,
        (walletDebitByPackage.get(txn.referenceId) || 0) + txn.amount,
      );
    }

    // Compute the wallet/online split for a UserPackage row. Mirrors
    // the bookings CSV logic so the two reports tell a consistent
    // story when a finance reviewer reconciles them.
    //   - Online portion → Payment.amount (the Razorpay-captured side)
    //   - Wallet portion → max(Payment.metadata.walletDeduction,
    //     WalletTransaction debit for this UserPackage). Either source
    //     can be missing depending on the purchase path.
    const splitForPackage = (up: typeof userPackages[number]): { wallet: number; online: number } => {
      const payment = paymentByUserPackage.get(up.id);
      const walletDebit = walletDebitByPackage.get(up.id) || 0;
      const onlinePortion = payment?.amount ?? 0;
      let walletPortion = walletDebit;
      if (payment && walletPortion === 0) {
        const meta = (payment.metadata as Record<string, unknown> | null) ?? null;
        if (typeof meta?.walletDeduction === 'number') walletPortion = meta.walletDeduction;
      }
      return { wallet: walletPortion, online: onlinePortion };
    };

    // Build CSV.
    //
    // `Booking Category` is the resource-based discriminator, labelled
    // from the same map the bookings CSV uses (`booking-categories.ts`)
    // so the two files name a category identically. Always the BASE
    // category — a Corporate Batch or Match Simulation package exports
    // as "Corporate Batch" / "Match Simulation" with no purchase-mode
    // suffix. For legacy ABCA packages (null `category` column) we
    // surface "Bowling Machine" to keep the column populated.
    //
    // `Ball Type` only applies to Bowling Machine packages — for every
    // other category we write "Not Applicable" so reviewers can tell
    // an unset cell from a category that genuinely doesn't have one.
    // Same convention as the bookings CSV (see
    // /api/admin/bookings/export).
    const headers = [
      'User Name',
      'Package Name',
      'Booking Category',
      'Machine Type',
      'Ball Type',
      'Total Sessions',
      'Used Sessions',
      'Remaining Sessions',
      'Amount Paid',
      // Split of Amount Paid across funding sources — handy when a
      // finance reviewer needs to reconcile wallet drawdowns vs.
      // Razorpay settlements.
      'Wallet Amount',
      'Online Amount',
      'Refunded Amount',
      'Status',
      // Date the package was purchased / assigned (UserPackage.createdAt),
      // IST. Replaces the former "Package Price" column.
      'Package Bought Date',
      'Activation Date',
      'Expiry Date',
    ];

    const rows = userPackages.map(up => {
      const split = splitForPackage(up);
      const category = up.package?.category ?? null;
      const ballTypeCell = categoryUsesBallType(category)
        ? (up.package?.ballType ? (PACKAGE_BALL_LABEL[up.package.ballType] || up.package.ballType) : '')
        : 'Not Applicable';
      return [
        up.user?.name || '',
        up.package?.name || '',
        packageCategoryLabel(category),
        up.package?.machineType || '',
        ballTypeCell,
        up.totalSessions,
        up.usedSessions,
        up.totalSessions - up.usedSessions,
        up.amountPaid,
        split.wallet,
        split.online,
        refundByPackage.get(up.id) || 0,
        up.status,
        up.createdAt ? new Date(up.createdAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : '',
        up.activationDate ? new Date(up.activationDate).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'Not Yet Activated',
        up.expiryDate ? new Date(up.expiryDate).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'N/A',
      ];
    });

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
    ].join('\n');

    return new NextResponse(csvContent, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="packages-report-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (error) {
    console.error('Admin package CSV export error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
