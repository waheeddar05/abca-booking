import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';

/**
 * Cross-center user lookup for admin assignment surfaces.
 *
 * GET /api/admin/users/search?q=foo
 *
 * Returns up to 20 active users whose name / email / mobile matches
 * the query. Intended for the "Assign user" typeahead in the Members
 * tab so an admin can pick an existing user instead of typing an
 * email. Unlike `/api/admin/users` (the main listing), this endpoint
 * is NOT scoped to a single center — adding someone from another
 * center to your own is the whole point.
 *
 * Auth: any ADMIN (super or center). Search term must be >= 2 chars
 * to avoid returning the whole user table.
 */
export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'ADMIN' && !user.isSuperAdmin) {
    return NextResponse.json({ error: 'Admin required' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get('q') ?? '').trim();
  if (q.length < 2) {
    return NextResponse.json({ users: [] });
  }

  const where: Prisma.UserWhereInput = {
    OR: [
      { name: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
      { mobileNumber: { contains: q } },
    ],
  };

  const users = await prisma.user.findMany({
    where,
    select: {
      id: true,
      name: true,
      email: true,
      mobileNumber: true,
      role: true,
      image: true,
      centerMemberships: {
        where: { isActive: true },
        select: {
          centerId: true,
          role: true,
          center: { select: { id: true, name: true, shortName: true } },
        },
      },
    },
    orderBy: [{ name: 'asc' }, { email: 'asc' }],
    take: 20,
  });

  return NextResponse.json({ users });
}
