import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireCenterAdmin } from '@/lib/adminAuth';
import { LedgerEntryInputSchema, toLedgerColumns } from '@/lib/ledger';
import {
  buildLedgerWhere,
  isCenterCollector,
  listCenterCollectors,
  LEDGER_ENTRY_SELECT,
  LEDGER_PAGE_SIZE,
} from '@/lib/ledger-query';

/**
 * Ledger — manually recorded revenue & expenses for the current center.
 *
 *   GET  /api/admin/ledger   List + totals (filtered)
 *   POST /api/admin/ledger   Create an entry
 *
 * Access: center ADMIN **and** MODERATOR (the restricted admin) may read
 * every entry and create new ones. Two things a moderator may NOT do,
 * both enforced in `[id]/route.ts`: edit an entry somebody else created,
 * and delete anything at all.
 *
 * Every query is scoped to the resolved current center — a ledger row is
 * center money and must never leak across centers.
 */

export async function GET(req: NextRequest) {
  try {
    const auth = await requireCenterAdmin(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const built = buildLedgerWhere(auth.center.id, searchParams);
    if ('error' in built) return NextResponse.json({ error: built.error }, { status: 400 });
    const { where, page } = built;

    const [entries, total, sum, recorderRows, handlerRows, collectors] = await Promise.all([
      prisma.ledgerEntry.findMany({
        where,
        select: LEDGER_ENTRY_SELECT,
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
      // Options for the "Collected By" / "Expenses Made By" filter.
      // Derived from the entries themselves rather than from the current
      // roster: somebody who took cash for a year and then left must stay
      // filterable, or their history becomes unreachable. Same reason the
      // recorder list above is entry-derived, and the same
      // filters-are-independent rule — unaffected by the active filters.
      prisma.ledgerEntry.findMany({
        where: { centerId: auth.center.id, collectedById: { not: null } },
        distinct: ['collectedById'],
        select: { collectedBy: { select: { id: true, name: true, email: true } } },
      }),
      listCenterCollectors(auth.center.id),
    ]);

    const byName = (
      a: { name: string | null; email: string | null },
      b: { name: string | null; email: string | null },
    ) => (a.name || a.email || '').localeCompare(b.name || b.email || '');

    return NextResponse.json({
      entries,
      total,
      page,
      pageSize: LEDGER_PAGE_SIZE,
      totalAmount: sum._sum.amount || 0,
      recorders: recorderRows.map((r) => r.recordedBy).filter(Boolean).sort(byName),
      handlers: handlerRows
        .map((r) => r.collectedBy)
        .filter((h): h is NonNullable<typeof h> => h !== null)
        .sort(byName),
      collectors,
      // ── Permission hints for the UI ──
      // Every one of these is re-checked server-side; hiding a control
      // is a convenience, not the security boundary.
      //
      // Deleting financial history is full-admin only. Moderators may
      // edit only what they themselves recorded, so the client needs to
      // know who it is to decide per row.
      canDelete: !auth.isModerator,
      canEditAll: !auth.isModerator,
      viewerId: auth.user.id,
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

    const columns = toLedgerColumns(parsed.data);

    if (
      columns.collectedById &&
      !(await isCenterCollector(auth.center.id, columns.collectedById))
    ) {
      return NextResponse.json(
        { error: 'Collected By must be a member of this center' },
        { status: 400 },
      );
    }

    const entry = await prisma.ledgerEntry.create({
      data: {
        centerId: auth.center.id,
        // "Recorded By" is captured from the session, never the body —
        // an admin can't attribute an entry to someone else.
        recordedById: auth.user.id,
        ...columns,
      },
      select: LEDGER_ENTRY_SELECT,
    });

    return NextResponse.json(entry, { status: 201 });
  } catch (error) {
    console.error('Ledger create error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
