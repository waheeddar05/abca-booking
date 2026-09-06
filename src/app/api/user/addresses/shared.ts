import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { UserAddressView } from '@/lib/addresses';

export const ADDRESS_SELECT = {
  id: true,
  label: true,
  fullName: true,
  phone: true,
  line1: true,
  line2: true,
  landmark: true,
  city: true,
  state: true,
  pincode: true,
  isDefault: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserAddressSelect;

type AddressRow = Prisma.UserAddressGetPayload<{ select: typeof ADDRESS_SELECT }>;

export function toAddressView(row: AddressRow): UserAddressView {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Default first, then oldest first — a stable order for the profile list. */
export async function listAddresses(userId: string): Promise<UserAddressView[]> {
  const rows = await prisma.userAddress.findMany({
    where: { userId },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    select: ADDRESS_SELECT,
  });
  return rows.map(toAddressView);
}
