import { NextRequest, NextResponse } from 'next/server';
import { runSerializable } from '@/lib/serializable-tx';
import { getAuthenticatedUser } from '@/lib/auth';
import { sanitizeApiError } from '@/lib/api-errors';
import { AddressInputSchema, MAX_ADDRESSES_PER_USER } from '@/lib/addresses';
import { ADDRESS_SELECT, listAddresses, toAddressView } from './shared';

/**
 * Delivery addresses on the signed-in user's profile.
 *
 *   GET  /api/user/addresses   list (default first)
 *   POST /api/user/addresses   add one (capped at MAX_ADDRESSES_PER_USER)
 *
 * Addresses are global to the account, not center-scoped. The first
 * address a user adds becomes the default automatically; adding one with
 * `isDefault: true` moves the default to it. Every write returns the
 * full refreshed list so the client just replaces its state.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ addresses: await listAddresses(user.id), max: MAX_ADDRESSES_PER_USER });
  } catch (error) {
    const { message, status } = sanitizeApiError(error, 'user.addresses.list');
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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

    // Serializable: the cap and the single-default rule are count/update-
    // then-write checks that two concurrent submits could otherwise both
    // pass (six addresses, or two defaults).
    const created = await runSerializable(async (tx) => {
      const count = await tx.userAddress.count({ where: { userId: user.id } });
      if (count >= MAX_ADDRESSES_PER_USER) {
        throw new AddressLimitError();
      }
      // The first address is always the default; otherwise honour the flag.
      const makeDefault = count === 0 || isDefault;
      if (makeDefault) {
        await tx.userAddress.updateMany({
          where: { userId: user.id, isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.userAddress.create({
        data: { ...fields, userId: user.id, isDefault: makeDefault },
        select: ADDRESS_SELECT,
      });
    });

    return NextResponse.json(
      { address: toAddressView(created), addresses: await listAddresses(user.id) },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof AddressLimitError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const { message, status } = sanitizeApiError(error, 'user.addresses.create');
    return NextResponse.json({ error: message }, { status });
  }
}

class AddressLimitError extends Error {
  constructor() {
    super(`You can save up to ${MAX_ADDRESSES_PER_USER} addresses — remove one to add another`);
    this.name = 'AddressLimitError';
  }
}
