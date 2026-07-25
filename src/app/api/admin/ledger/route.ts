import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireCenterAdmin } from '@/lib/adminAuth';
import { LedgerEntryInputSchema, toLedgerColumns } from '@/lib/ledger';
import { buildLedgerWhere, LEDGER_PAGE_SIZE } from '@/lib/ledger-query';

/**
 * Ledger — manually recorded revenue & expenses for the current center.
 *
 *   GET  /api/admin/ledger   List + totals (filtered)
 *   POST /api/admin/ledger   Create an entry
 *
 * Access: center ADMIN **and** MODERATOR (the restricted admin) may read
 * and create; deletion is full-admin-only and lives in `[id]/route.ts`.
 * `requireCenterAdmin` admits both and reports which one via
 * `isModerator`, so the guard is one call.
 *
 * Every query is scoped to the resolved current center — a ledger row is
 * center money and must never leak across centers.
 */

const ENTRY_SELECT = {
  id: true,
  kind: true,
  revenueCategory: true,
  customerName: true,
  serviceDate: true,
  serviceTime: true,
  expenseCategory: true,
  expenseSubcategory: true,
  description: true,
  paidTo: true,
  amount: true,
  entryDate: true,
  entryTime: true,
  paymentMethod: true,
  remarks: true,
  recordedById: true,
  recordedBy: { select: { id: true, name: true, email: true } },
  createdAt: true,
  updatedAt: true,
} as const;

export async function GET(req: NextRequest) {
  try {
    const auth = await requireCenterAdmin(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const built = buildLedgerWhere(auth.center.id, searchParams);
    if ('error' in built) return NextResponse.json({ error: built.error }, { status: 400 });
    const { where, page } = built;

    const [entries, total, sum, recorderRows] = await Promise.all([
      prisma.ledgerEntry.findMany({
        where,
        select: ENTRY_SELECT,
        // Newest money first; createdAt breaks ties within a day.
        orderBy: [{ entryDate: 'desc' }, { entryTime: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * LEDGER_PAGE_SIZE,
        take: LEDGER_PAGE_SIZE,
      }),
      prisma.ledgerEntry.count({ where }),
      prisma.ledgerEntry.aggregate({ where, _sum: { amount: true } }),
      // Options for the "Recorded By" filter — everyone who has ever
      // recorded an entry at this center, regardless of active filters,
      // so narrowing the list can't remove the way back out.
      prisma.ledgerEntry.findMany({
        where: { centerId: auth.center.id },
        distinct: ['recordedById'],
        select: { recordedBy: { select: { id: true, name: true, email: true } } },
      }),
    ]);

    return NextResponse.json({
      entries,
      total,
      page,
      pageSize: LEDGER_PAGE_SIZE,
      totalAmount: sum._sum.amount || 0,
      recorders: recorderRows
        .map((r) => r.recordedBy)
        .filter(Boolean)
        .sort((a, b) => (a.name || a.email || '').localeCompare(b.name || b.email || '')),
      // Moderators may create and edit but not delete; the UI hides the
      // delete control off this flag (the [id] route enforces it).
      canDelete: !auth.isModerator,
    });
  } catch (error) {
    console.error('Ledger list error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireCenterAdmin(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const parsed = LedgerEntryInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Validation failed' },
        { status: 400 },
      );
    }

    const entry = await prisma.ledgerEntry.create({
      data: {
        centerId: auth.center.id,
        // "Recorded By" is captured from the session, never the body —
        // an admin can't attribute an entry to someone else.
        recordedById: auth.user.id,
        ...toLedgerColumns(parsed.data),
      },
      select: ENTRY_SELECT,
    });

    return NextResponse.json(entry, { status: 201 });
  } catch (error) {
    console.error('Ledger create error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
