import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireCenterAdmin } from '@/lib/adminAuth';
import { LedgerEntryInputSchema, toLedgerColumns } from '@/lib/ledger';
import { isCenterCollector, LEDGER_ENTRY_SELECT } from '@/lib/ledger-query';

/**
 * PATCH  /api/admin/ledger/[id]   Update an entry
 * DELETE /api/admin/ledger/[id]   Delete an entry (full admin only)
 *
 * Permissions:
 *   - Full admin  — edit and delete any entry at the center.
 *   - Moderator   — edit ONLY entries they recorded themselves; never
 *                   delete, whoever recorded it.
 *
 * Both verbs re-fetch the row and check it belongs to the caller's
 * current center before touching it — the id alone must never be enough
 * to reach another center's books.
 *
 * PATCH takes a COMPLETE entry rather than a partial patch: the
 * per-kind required fields (customer name on revenue, description on
 * expenses, subcategory where the category has one) can only be
 * enforced when the whole object is present.
 */

type Params = { id: string };

export async function PATCH(req: NextRequest, ctx: { params: Promise<Params> }) {
  try {
    const auth = await requireCenterAdmin(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

    const { id } = await ctx.params;

    const existing = await prisma.ledgerEntry.findUnique({
      where: { id },
      select: { id: true, centerId: true, recordedById: true },
    });
    if (!existing || existing.centerId !== auth.center.id) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
    }

    // A moderator may correct their own entries but not somebody
    // else's — their own or another moderator's is the line, and an
    // admin's entries are certainly off-limits.
    if (auth.isModerator && existing.recordedById !== auth.user.id) {
      return NextResponse.json(
        { error: 'Moderators can only edit entries they recorded themselves' },
        { status: 403 },
      );
    }

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

    // `recordedById` is deliberately left untouched — it records who
    // originally booked the money, not who last touched the row. (It is
    // also what the moderator check above keys off, so rewriting it
    // would let an edit hand ownership away.)
    const entry = await prisma.ledgerEntry.update({
      where: { id },
      data: columns,
      select: LEDGER_ENTRY_SELECT,
    });

    return NextResponse.json(entry);
  } catch (error) {
    console.error('Ledger update error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<Params> }) {
  try {
    const auth = await requireCenterAdmin(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

    // Deleting financial history is full-admin territory. Moderators can
    // create and correct entries but never make one disappear — not even
    // one they recorded themselves.
    if (auth.isModerator) {
      return NextResponse.json(
        { error: 'Moderators cannot delete ledger entries' },
        { status: 403 },
      );
    }

    const { id } = await ctx.params;
    const existing = await prisma.ledgerEntry.findUnique({
      where: { id },
      select: { id: true, centerId: true },
    });
    if (!existing || existing.centerId !== auth.center.id) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
    }

    await prisma.ledgerEntry.delete({ where: { id } });
    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error('Ledger delete error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
