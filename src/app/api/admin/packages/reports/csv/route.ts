import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/adminAuth';

// GET /api/admin/packages/reports/csv - Download user packages as CSV
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};
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
      'Package Price',
      'Status',
      'Activation Date',
      'Expiry Date',
    ];

    const rows = userPackages.map(up => [
      up.user?.name || '',
      up.user?.email || '',
      up.user?.mobileNumber || '',
      up.package?.name || '',
      up.package?.machineType || '',
      up.totalSessions,
      up.usedSessions,
      up.totalSessions - up.usedSessions,
      up.amountPaid,
      up.package?.price || '',
      up.status,
      new Date(up.activationDate).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }),
      new Date(up.expiryDate).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }),
    ]);

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
