import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/adminAuth';
import { getAuthenticatedUser } from '@/lib/auth';
import { resolveCurrentCenter } from '@/lib/centers';

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
    if (fromDate || toDate) {
      where.activationDate = {} as { gte?: Date; lte?: Date };
      if (fromDate) where.activationDate.gte = new Date(fromDate);
      if (toDate) {
        const end = new Date(toDate);
        end.setHours(23, 59, 59, 999);
        where.activationDate.lte = end;
      }
    }

    const userPackages = await prisma.userPackage.findMany({
      where,
      include: {
        user: { select: { name: true, email: true, mobileNumber: true } },
        package: { select: { name: true, machineType: true, totalSessions: true, price: true } },
      },
      orderBy: { activationDate: 'desc' },
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

    // Build CSV
    const headers = [
      'User Name',
      'Email',
      'Mobile',
      'Package Name',
      'Machine Type',
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
      'Package Price',
      'Status',
      'Activation Date',
      'Expiry Date',
    ];

    const rows = userPackages.map(up => {
      const split = splitForPackage(up);
      return [
        up.user?.name || '',
        up.user?.email || '',
        up.user?.mobileNumber || '',
        up.package?.name || '',
        up.package?.machineType || '',
        up.totalSessions,
        up.usedSessions,
        up.totalSessions - up.usedSessions,
        up.amountPaid,
        split.wallet,
        split.online,
        refundByPackage.get(up.id) || 0,
        up.package?.price || '',
        up.status,
        new Date(up.activationDate).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }),
        new Date(up.expiryDate).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }),
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
