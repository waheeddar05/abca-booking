import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireCenterAdmin } from '@/lib/adminAuth';
import { LedgerEntryInputSchema, toLedgerColumns } from '@/lib/ledger';

/**
 * PATCH  /api/admin/ledger/[id]   Update an entry (admin + moderator)
 * DELETE /api/admin/ledger/[id]   Delete an entry (full admin only)
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
      select: { id: true, centerId: true },
    });
    if (!existing || existing.centerId !== auth.center.id) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
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

    // `recordedById` is deliberately left untouched — it records who
    // originally booked the money, not who last touched the row.
    const entry = await prisma.ledgerEntry.update({
      where: { id },
      data: toLedgerColumns(parsed.data),
      select: {
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
      },
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
    // create and correct entries but never make one disappear.
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
