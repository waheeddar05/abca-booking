import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireCenterAdmin } from '@/lib/adminAuth';
import { buildLedgerWhere } from '@/lib/ledger-query';
import {
  LEDGER_PAYMENT_METHOD_LABELS,
  expenseSubcategoryLabel,
  ledgerCategoryLabel,
  type LedgerExpenseCategoryId,
  type LedgerPaymentMethodId,
} from '@/lib/ledger';

/**
 * GET /api/admin/ledger/export — download the filtered ledger as CSV.
 *
 * Takes the exact same query params as the list endpoint and reuses its
 * `where` builder, so the file always contains precisely the rows the
 * admin is looking at (same kind, date range, category, payment method,
 * recorded-by and search filters) — just unpaginated.
 */

function istDate(d: Date | null): string {
  return d ? new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : '';
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireCenterAdmin(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const built = buildLedgerWhere(auth.center.id, searchParams);
    if ('error' in built) return NextResponse.json({ error: built.error }, { status: 400 });

    const isRevenue = built.kind === 'REVENUE';

    const entries = await prisma.ledgerEntry.findMany({
      where: built.where,
      orderBy: [{ entryDate: 'desc' }, { entryTime: 'desc' }, { createdAt: 'desc' }],
      select: {
        kind: true,
        revenueCategory: true,
        customerName: true,
        serviceDate: true,
        serviceStartTime: true,
        serviceEndTime: true,
        expenseCategory: true,
        expenseSubcategory: true,
        description: true,
        paidTo: true,
        amount: true,
        entryDate: true,
        entryTime: true,
        paymentMethod: true,
        remarks: true,
        collectedBy: { select: { name: true, email: true } },
        recordedBy: { select: { name: true, email: true } },
      },
    });

    const headers = isRevenue
      ? [
          'Payment Date',
          'Payment Time',
          'Category',
          'Customer Name',
          'Session Date',
          'Session From',
          'Session To',
          'Amount',
          'Payment Method',
          'Collected By',
          'Recorded By',
          'Remarks',
        ]
      : [
          'Payment Date',
          'Payment Time',
          'Category',
          'Subcategory',
          'Description',
          'Paid To / Vendor',
          'Amount',
          'Payment Method',
          'Paid By',
          'Recorded By',
          'Remarks',
        ];

    const rows = entries.map((e) => {
      const method =
        LEDGER_PAYMENT_METHOD_LABELS[e.paymentMethod as LedgerPaymentMethodId] || e.paymentMethod;
      const recordedBy = e.recordedBy?.name || e.recordedBy?.email || '';
      const collectedBy = e.collectedBy?.name || e.collectedBy?.email || '';
      const category = ledgerCategoryLabel(e);
      return isRevenue
        ? [
            istDate(e.entryDate),
            e.entryTime,
            category,
            e.customerName || '',
            istDate(e.serviceDate),
            e.serviceStartTime || '',
            e.serviceEndTime || '',
            e.amount,
            method,
            collectedBy,
            recordedBy,
            e.remarks || '',
          ]
        : [
            istDate(e.entryDate),
            e.entryTime,
            category,
            expenseSubcategoryLabel(
              e.expenseCategory as LedgerExpenseCategoryId | null,
              e.expenseSubcategory,
            ),
            e.description || '',
            e.paidTo || '',
            e.amount,
            method,
            collectedBy,
            recordedBy,
            e.remarks || '',
          ];
    });

    const csvContent = [
      headers.join(','),
      ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
    ].join('\n');

    const label = isRevenue ? 'manual-revenue' : 'expenses';
    return new NextResponse(csvContent, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${label}-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (error) {
    console.error('Ledger CSV export error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
