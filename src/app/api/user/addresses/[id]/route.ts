import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';
import { sanitizeApiError } from '@/lib/api-errors';
import { AddressInputSchema } from '@/lib/addresses';
import { ADDRESS_SELECT, listAddresses, toAddressView } from '../shared';

type Params = { id: string };

/**
 *   PATCH  /api/user/addresses/[id]   replace an address (complete body)
 *   DELETE /api/user/addresses/[id]   remove it
 *
 * Both verbs re-fetch the row and check it belongs to the caller — an id
 * alone must never reach another account's address. PATCH takes the
 * whole address (same schema as create) so required fields can't be
 * blanked one at a time.
 *
 * Default handling: setting `isDefault: true` moves the default here.
 * The current default can't be *unset* (there'd be no default while
 * addresses remain) — it only moves when another address takes it.
 * Deleting the default promotes the oldest remaining address.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<Params> }) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await ctx.params;
    const existing = await prisma.userAddress.findUnique({
      where: { id },
      select: { id: true, userId: true, isDefault: true },
    });
    if (!existing || existing.userId !== user.id) {
      return NextResponse.json({ error: 'Address not found' }, { status: 404 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const parsed = AddressInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Validation failed' },
        { status: 400 },
      );
    }
    const { isDefault, ...fields } = parsed.data;
    const makeDefault = existing.isDefault || isDefault;

    const updated = await prisma.$transaction(async (tx) => {
      if (makeDefault && !existing.isDefault) {
        await tx.userAddress.updateMany({
          where: { userId: user.id, isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.userAddress.update({
        where: { id },
        data: { ...fields, isDefault: makeDefault },
        select: ADDRESS_SELECT,
      });
    });

    return NextResponse.json({ address: toAddressView(updated), addresses: await listAddresses(user.id) });
  } catch (error) {
    const { message, status } = sanitizeApiError(error, 'user.addresses.update');
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<Params> }) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await ctx.params;
    const existing = await prisma.userAddress.findUnique({
      where: { id },
      select: { id: true, userId: true, isDefault: true },
    });
    if (!existing || existing.userId !== user.id) {
      return NextResponse.json({ error: 'Address not found' }, { status: 404 });
    }

    await prisma.$transaction(async (tx) => {
      await tx.userAddress.delete({ where: { id } });
      if (existing.isDefault) {
        const next = await tx.userAddress.findFirst({
          where: { userId: user.id },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        });
        if (next) {
          await tx.userAddress.update({ where: { id: next.id }, data: { isDefault: true } });
        }
      }
    });

    return NextResponse.json({ deleted: true, addresses: await listAddresses(user.id) });
  } catch (error) {
    const { message, status } = sanitizeApiError(error, 'user.addresses.delete');
    return NextResponse.json({ error: message }, { status });
  }
}
