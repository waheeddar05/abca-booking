/**
 * Admin user management — center-scoped (Stage 5).
 *
 * Before: this route returned every user in the system regardless of
 * which center the admin was looking at. After: it returns only users
 * with a presence at the admin's current center (a CenterMembership
 * OR at least one Booking). Super admins can pass `?allCenters=true`
 * to get the legacy cross-center view, mirroring the same convention
 * used by other admin endpoints.
 *
 * Role changes write to BOTH layers:
 *   - `User.role` (legacy global gate used by middleware/getSession)
 *   - `CenterMembership(centerId, role)` (the per-center grant used
 *     by `hasMembershipRole`/`requireCenterAdmin`).
 *
 * When demoting at one center, we only clear User.role if the user has
 * no remaining membership of that role at any other center, so a multi-
 * center admin doesn't lose their global gate by being unassigned from
 * a single center.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';
import { resolveCurrentCenter } from '@/lib/centers';

const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'waheeddar8@gmail.com';

/** Roles that have a CenterMembership counterpart. USER is the absence
 *  of any staff membership. Both enums use SIDEARM_SPECIALIST (legacy
 *  SIDEARM_STAFF was renamed in-place via a migration). */
const MEMBERSHIP_ROLES = ['ADMIN', 'OPERATOR', 'COACH', 'SIDEARM_SPECIALIST'] as const;
type MembershipRoleString = (typeof MEMBERSHIP_ROLES)[number];

function toMembershipRole(role: string): MembershipRoleString | null {
  return (MEMBERSHIP_ROLES as readonly string[]).includes(role)
    ? (role as MembershipRoleString)
    : null;
}

/** Ensure a CenterMembership(userId, centerId, role) exists and is
 *  active. The schema's `@@unique` is `(userId, centerId, role)` so a
 *  user can hold multiple roles at the same center simultaneously
 *  (e.g. Coach + Sidearm Specialist).
 *
 *  Previously this also DELETED every other role at the center to
 *  enforce a "one role per user per center" view that matches the
 *  single-valued `User.role` legacy column. That turned out to be
 *  the wrong default: a center admin who wanted to ADD an Operator
 *  role to an existing Coach from /admin/users would silently lose
 *  the Coach membership. We now only ensure the target role exists;
 *  other roles stay untouched. Deliberate demotions / cleanups still
 *  happen via the explicit `role === 'USER'` branch in the PATCH
 *  handler, which does a full sweep of memberships at this center. */
async function setCenterMembership(
  tx: Prisma.TransactionClient,
  userId: string,
  centerId: string,
  role: MembershipRoleString,
): Promise<void> {
  const existing = await tx.centerMembership.findFirst({
    where: { userId, centerId, role },
    select: { id: true },
  });
  if (existing) {
    await tx.centerMembership.update({
      where: { id: existing.id },
      data: { isActive: true },
    });
  } else {
    await tx.centerMembership.create({
      data: { userId, centerId, role, isActive: true },
    });
  }
}

async function getActor(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user) return null;
  if (user.role !== 'ADMIN' && !user.isSuperAdmin) return null;
  return user;
}

/**
 * GET /api/admin/users
 *
 * Query params:
 *   search       free-text match on name/email/mobile
 *   role         filter by User.role (USER | ADMIN | OPERATOR)
 *   allCenters   "true" — super admin only — returns every user in the system
 */
export async function GET(req: NextRequest) {
  try {
    const actor = await getActor(req);
    if (!actor) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search');
    const role = searchParams.get('role');
    const allCenters = searchParams.get('allCenters') === 'true';

    if (allCenters && !actor.isSuperAdmin) {
      return NextResponse.json({ error: 'allCenters requires super admin' }, { status: 403 });
    }

    const where: Prisma.UserWhereInput = {};
    if (role && (role === 'ADMIN' || role === 'USER' || role === 'OPERATOR')) {
      where.role = role;
    }
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { mobileNumber: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Center scoping. A user "belongs to" a center if either:
    //   - they're a member of it (staff role), or
    //   - they've ever booked there (customer).
    // Super admins with allCenters=true skip this filter; everyone else
    // is scoped to the resolved center.
    let scopedCenterId: string | null = null;
    if (!allCenters) {
      const center = await resolveCurrentCenter(req, actor);
      if (!center) {
        return NextResponse.json({ error: 'No center selected' }, { status: 400 });
      }
      scopedCenterId = center.id;
      const centerFilter: Prisma.UserWhereInput = {
        OR: [
          { centerMemberships: { some: { centerId: center.id } } },
          { bookings: { some: { centerId: center.id } } },
        ],
      };
      // Compose with the search filter (which may already use OR). When
      // both `where.OR` (search) and centerFilter are set we need AND
      // semantics so a centerless match doesn't leak through.
      if (where.OR) {
        where.AND = [{ OR: where.OR }, centerFilter];
        delete where.OR;
      } else {
        Object.assign(where, centerFilter);
      }
    }

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        mobileNumber: true,
        image: true,
        authProvider: true,
        role: true,
        isBlacklisted: true,
        isFreeUser: true,
        isSpecialUser: true,
        specialDiscountType: true,
        specialDiscountValue: true,
        createdAt: true,
        lastSeen: true,
        // Per-center memberships so the UI can show which centers a
        // user is staff at. Helpful for the super-admin allCenters view.
        centerMemberships: {
          select: {
            centerId: true,
            role: true,
            isActive: true,
            center: { select: { id: true, name: true, slug: true } },
          },
        },
        // Wallet balance(s) so the User Management list can surface
        // funds upfront without a per-row API call. Center admins see
        // only their current center's wallet; super admins see every
        // wallet for the user. Pruned to the relevant scope below.
        wallets: {
          select: { centerId: true, balance: true },
        },
        _count: {
          select: { bookings: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Compute a single `walletBalance` per user for the UI. For center
    // admins this is the balance at the resolved center; for the super
    // admin allCenters view we sum across every wallet they hold.
    const enriched = users.map((u) => {
      const relevantWallets = scopedCenterId
        ? u.wallets.filter((w) => w.centerId === scopedCenterId)
        : u.wallets;
      const walletBalance = relevantWallets.reduce((sum, w) => sum + w.balance, 0);
      // Drop the raw wallets array from the response — the UI only
      // needs the rolled-up total. Keep the shape lean.
      const { wallets: _ignored, ...rest } = u;
      void _ignored;
      return { ...rest, walletBalance };
    });

    return NextResponse.json(enriched);
  } catch (error) {
    console.error('Admin users fetch error:', error);
    return NextResponse.json({ error: 'Failed to load users. Please try again.' }, { status: 500 });
  }
}

/**
 * POST /api/admin/users
 * Body: { email, name?, role?, centerId? }
 *
 * Creates (or upserts on email) a User. Optionally grants the new user
 * a staff role at the admin's current center via a CenterMembership.
 */
export async function POST(req: NextRequest) {
  try {
    const actor = await getActor(req);
    if (!actor) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { email, name, role, centerId: bodyCenterId } = await req.json();

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    // Only super admin can promote to ADMIN, anywhere.
    const targetRole = role === 'ADMIN' && !actor.isSuperAdmin ? 'USER' : (role || 'USER');

    // Center for the membership grant. Defaults to actor's current
    // center when not passed; super admins may target a specific center
    // via bodyCenterId.
    let membershipCenterId: string | null = null;
    if (targetRole !== 'USER') {
      if (bodyCenterId && actor.isSuperAdmin) {
        membershipCenterId = bodyCenterId;
      } else {
        const resolved = await resolveCurrentCenter(req, actor);
        membershipCenterId = resolved?.id ?? null;
      }
      if (!membershipCenterId) {
        return NextResponse.json(
          { error: 'No center selected; pick a center before granting a staff role.' },
          { status: 400 },
        );
      }
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    const user = existing
      ? await prisma.user.update({
          where: { id: existing.id },
          data: {
            role: targetRole,
            ...(name && { name }),
          },
        })
      : await prisma.user.create({
          data: {
            email,
            name: name || null,
            role: targetRole,
            authProvider: 'GOOGLE',
          },
        });

    // Mirror the role grant into CenterMembership for the resolved
    // center. USER has no membership; staff roles upsert one.
    if (membershipCenterId && targetRole !== 'USER') {
      const membershipRole = toMembershipRole(targetRole);
      if (membershipRole) {
        await prisma.$transaction((tx) =>
          setCenterMembership(tx, user.id, membershipCenterId!, membershipRole),
        );
      }
    }

    return NextResponse.json({
      message: existing ? 'User updated successfully' : 'User added successfully',
      user,
    });
  } catch (error: unknown) {
    console.error('Admin user add error:', error);
    const message = error instanceof Error ? error.message : '';
    if (message.includes('invalid input value for enum')) {
      return NextResponse.json({ error: 'Invalid role value. Please run database migrations.' }, { status: 400 });
    }
    if (message.includes('Unique constraint')) {
      return NextResponse.json({ error: 'A user with this email already exists.' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Failed to add user. Please try again.' }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/users
 * Body: { id, role?, isFreeUser?, isSpecialUser?, specialDiscountType?, specialDiscountValue?, centerId? }
 *
 * Role updates touch both layers:
 *   - User.role gets the new value (or rolled back to USER on demotion
 *     when no other centers grant that role).
 *   - CenterMembership at the resolved center is upserted (or removed
 *     on demotion).
 */
export async function PATCH(req: NextRequest) {
  try {
    const actor = await getActor(req);
    if (!actor) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const {
      id,
      role,
      isFreeUser,
      isSpecialUser,
      specialDiscountType,
      specialDiscountValue,
      centerId: bodyCenterId,
    } = await req.json();

    if (!id) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    const validRoles = ['USER', 'ADMIN', 'OPERATOR', 'COACH', 'SIDEARM_SPECIALIST'];
    if (role && !validRoles.includes(role)) {
      return NextResponse.json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` }, { status: 400 });
    }

    const validDiscountTypes = ['PERCENTAGE', 'FIXED'];
    if (specialDiscountType !== null && specialDiscountType !== undefined && !validDiscountTypes.includes(specialDiscountType)) {
      return NextResponse.json({ error: `Invalid discount type. Must be one of: ${validDiscountTypes.join(', ')}` }, { status: 400 });
    }

    if (specialDiscountValue !== undefined && specialDiscountValue !== null && (typeof specialDiscountValue !== 'number' || specialDiscountValue < 0)) {
      return NextResponse.json({ error: 'Discount value must be a positive number' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Prevent changing super admin's role
    if (user.email === SUPER_ADMIN_EMAIL) {
      return NextResponse.json({ error: 'Cannot modify super admin' }, { status: 400 });
    }

    // Only super admin can promote/demote admins
    if (role && (role === 'ADMIN' || user.role === 'ADMIN') && !actor.isSuperAdmin) {
      return NextResponse.json({ error: 'Only super admin can change admin roles' }, { status: 403 });
    }

    // Only super admin can toggle free user status
    if (typeof isFreeUser === 'boolean' && !actor.isSuperAdmin) {
      return NextResponse.json({ error: 'Only super admin can set free user status' }, { status: 403 });
    }

    // Resolve the target center for membership updates. Super admins may
    // pass bodyCenterId; everyone else uses the cookie-resolved center.
    let centerId: string | null = null;
    if (role) {
      if (bodyCenterId && actor.isSuperAdmin) {
        centerId = bodyCenterId;
      } else {
        const resolved = await resolveCurrentCenter(req, actor);
        centerId = resolved?.id ?? null;
      }
      if (!centerId) {
        return NextResponse.json(
          { error: 'No center selected; cannot change role without a center context.' },
          { status: 400 },
        );
      }
    }

    // Apply changes inside a single transaction so the global role and
    // the per-center membership can't drift apart on partial failure.
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id },
        data: {
          ...(role && { role }),
          ...(typeof isFreeUser === 'boolean' ? { isFreeUser } : {}),
          ...(typeof isSpecialUser === 'boolean' ? { isSpecialUser } : {}),
          ...(specialDiscountType !== undefined ? { specialDiscountType } : {}),
          ...(specialDiscountValue !== undefined ? { specialDiscountValue } : {}),
        },
      });

      if (role && centerId) {
        const membershipRole = toMembershipRole(role);
        if (membershipRole) {
          // Promotion / lateral move → upsert the membership at this center.
          await setCenterMembership(tx, id, centerId, membershipRole);
        } else if (role === 'USER') {
          // Demotion at this center: remove every membership at this
          // center. If the user still has staff memberships at OTHER
          // centers, restore their User.role so they can keep working
          // there. Prefer a membership role that maps to a UserRole
          // (ADMIN > OPERATOR > COACH > SIDEARM_SPECIALIST). GROUND_STAFF
          // is a center-side facility role with no UserRole equivalent —
          // if that's all the user has left, fall back to plain USER and
          // keep the membership intact.
          await tx.centerMembership.deleteMany({ where: { userId: id, centerId } });
          const otherMemberships = await tx.centerMembership.findMany({
            where: { userId: id, isActive: true },
            select: { role: true },
          });
          const PROMOTABLE: MembershipRoleString[] = ['ADMIN', 'OPERATOR', 'COACH', 'SIDEARM_SPECIALIST'];
          const fallback = PROMOTABLE.find((r) => otherMemberships.some((m) => m.role === r));
          if (fallback) {
            await tx.user.update({
              where: { id },
              data: { role: fallback },
            });
          }
        }
      }

      return u;
    });

    return NextResponse.json({ message: 'User updated', user: updated });
  } catch (error: unknown) {
    console.error('Admin user update error:', error);
    const message = error instanceof Error ? error.message : '';
    if (message.includes('invalid input value for enum')) {
      const match = message.match(/invalid input value for enum "(\w+)": "(\w+)"/);
      return NextResponse.json(
        { error: `Role "${match?.[2] || 'unknown'}" is not available yet. Please run database migrations.` },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: 'Failed to update user. Please try again.' }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/users
 * Hard-deletes a user and every record tied to them. Super-admin only;
 * cleanup runs in a single transaction.
 */
export async function DELETE(req: NextRequest) {
  try {
    const actor = await getActor(req);
    if (!actor) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    if (!actor.isSuperAdmin) {
      return NextResponse.json({ error: 'Only super admin can delete users' }, { status: 403 });
    }

    const { id } = await req.json();

    if (!id) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (user.email === SUPER_ADMIN_EMAIL) {
      return NextResponse.json({ error: 'Cannot delete super admin' }, { status: 400 });
    }

    // Delete all related records in correct order (respecting foreign keys)
    // Use a transaction to ensure atomicity
    await prisma.$transaction(async (tx) => {
      // 1. Get user's bookings to delete their sub-relations (refunds)
      const userBookings = await tx.booking.findMany({
        where: { userId: id },
        select: { id: true },
      });
      const bookingIds = userBookings.map(b => b.id);

      if (bookingIds.length > 0) {
        // Delete refunds tied to user's bookings
        await tx.refund.deleteMany({ where: { bookingId: { in: bookingIds } } });
      }

      // 2. Delete refunds initiated by this user (adminRefunds relation)
      const remainingAdminRefunds = await tx.refund.findMany({
        where: { initiatedById: id },
        select: { id: true },
      });
      if (remainingAdminRefunds.length > 0) {
        await tx.refund.deleteMany({
          where: { id: { in: remainingAdminRefunds.map(r => r.id) } },
        });
      }

      // 3. Get user's packages to delete their sub-relations
      const userPackages = await tx.userPackage.findMany({
        where: { userId: id },
        select: { id: true },
      });
      const userPackageIds = userPackages.map(up => up.id);

      if (userPackageIds.length > 0) {
        await tx.packageAuditLog.deleteMany({ where: { userPackageId: { in: userPackageIds } } });
        await tx.packageBooking.deleteMany({ where: { userPackageId: { in: userPackageIds } } });
      }

      // 4. Delete every wallet (across centers) and its transactions
      const wallets = await tx.wallet.findMany({ where: { userId: id } });
      if (wallets.length > 0) {
        const walletIds = wallets.map((w) => w.id);
        await tx.walletTransaction.deleteMany({ where: { walletId: { in: walletIds } } });
        await tx.wallet.deleteMany({ where: { id: { in: walletIds } } });
      }

      // 5. Nullify operatorId on bookings where this user was the operator
      await tx.booking.updateMany({
        where: { operatorId: id },
        data: { operatorId: null },
      });

      // 6. Delete all direct user relations
      await tx.userPackage.deleteMany({ where: { userId: id } });
      await tx.notification.deleteMany({ where: { userId: id } });
      await tx.payment.deleteMany({ where: { userId: id } });
      await tx.booking.deleteMany({ where: { userId: id } });
      await tx.otp.deleteMany({ where: { userId: id } });
      // OperatorAssignment, CashPaymentUser, CenterMembership have onDelete: Cascade

      // 7. Finally delete the user
      await tx.user.delete({ where: { id } });
    });

    return NextResponse.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Admin user delete error:', error);
    return NextResponse.json({ error: 'Failed to delete user. Please try again.' }, { status: 500 });
  }
}
