import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getToken } from 'next-auth/jwt';
import { verifyToken } from '@/lib/jwt';


async function getSession(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (token) return { role: token.role, email: token.email };

  const otpTokenStr = req.cookies.get('token')?.value;
  if (otpTokenStr) {
    const otpToken = verifyToken(otpTokenStr) as any;
    return { role: otpToken?.role, email: otpToken?.email };
  }
  return null;
}

export async function GET(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (session?.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search');
    const role = searchParams.get('role');

    const where: any = {};
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
        _count: {
          select: { bookings: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(users);
  } catch (error) {
    console.error('Admin users fetch error:', error);
    return NextResponse.json({ error: 'Failed to load users. Please try again.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (session?.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { email, name, role } = await req.json();

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    // Only super admin can set role to ADMIN
    const targetRole = role === 'ADMIN' && session.email !== 'waheeddar8@gmail.com' ? 'USER' : (role || 'USER');

    const existingUser = await prisma.user.findUnique({ where: { email } });

    if (existingUser) {
      // If updating role to ADMIN, only super admin can do that
      if (targetRole === 'ADMIN' && session.email !== 'waheeddar8@gmail.com') {
        return NextResponse.json({ error: 'Only super admin can promote users to admin' }, { status: 403 });
      }
      const updated = await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          role: targetRole,
          ...(name && { name }),
        },
      });
      return NextResponse.json({ message: 'User updated successfully', user: updated });
    } else {
      const newUser = await prisma.user.create({
        data: {
          email,
          name: name || null,
          role: targetRole,
          authProvider: 'GOOGLE',
        },
      });
      return NextResponse.json({ message: 'User added successfully', user: newUser });
    }
  } catch (error: any) {
    console.error('Admin user add error:', error);
    const message = error?.message || '';
    if (message.includes('invalid input value for enum')) {
      return NextResponse.json({ error: 'Invalid role value. Please run database migrations.' }, { status: 400 });
    }
    if (message.includes('Unique constraint')) {
      return NextResponse.json({ error: 'A user with this email already exists.' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Failed to add user. Please try again.' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (session?.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { id, role, isFreeUser, isSpecialUser, specialDiscountType, specialDiscountValue } = await req.json();

    if (!id) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    const validRoles = ['USER', 'ADMIN', 'OPERATOR'];
    if (role && !validRoles.includes(role)) {
      return NextResponse.json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` }, { status: 400 });
    }

    const validDiscountTypes = ['PERCENTAGE', 'FIXED'];
    if (specialDiscountType && !validDiscountTypes.includes(specialDiscountType)) {
      return NextResponse.json({ error: `Invalid discount type. Must be one of: ${validDiscountTypes.join(', ')}` }, { status: 400 });
    }

    if (specialDiscountValue !== undefined && (typeof specialDiscountValue !== 'number' || specialDiscountValue < 0)) {
      return NextResponse.json({ error: 'Discount value must be a positive number' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Prevent changing super admin's role
    if (user.email === 'waheeddar8@gmail.com') {
      return NextResponse.json({ error: 'Cannot modify super admin' }, { status: 400 });
    }

    // Only super admin can promote/demote admins
    if (role && (role === 'ADMIN' || user.role === 'ADMIN') && session.email !== 'waheeddar8@gmail.com') {
      return NextResponse.json({ error: 'Only super admin can change admin roles' }, { status: 403 });
    }

    // Only super admin can toggle free user status
    if (typeof isFreeUser === 'boolean' && session.email !== 'waheeddar8@gmail.com') {
      return NextResponse.json({ error: 'Only super admin can set free user status' }, { status: 403 });
    }

    // Any admin can change special user status and discount
    // (no super admin restriction)

    const updated = await prisma.user.update({
      where: { id },
      data: {
        ...(role && { role }),
        ...(typeof isFreeUser === 'boolean' ? { isFreeUser } : {}),
        ...(typeof isSpecialUser === 'boolean' ? { isSpecialUser } : {}),
        ...(specialDiscountType ? { specialDiscountType } : {}),
        ...(specialDiscountValue !== undefined ? { specialDiscountValue } : {}),
      },
    });

    return NextResponse.json({ message: 'User updated', user: updated });
  } catch (error: any) {
    console.error('Admin user update error:', error);
    const message = error?.message || '';
    if (message.includes('invalid input value for enum')) {
      const match = message.match(/invalid input value for enum "(\w+)": "(\w+)"/);
      return NextResponse.json(
        { error: `Role "${match?.[2] || 'unknown'}" is not available yet. Please run database migrations.` },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: 'Failed to update user. Please try again.' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (session?.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    if (session.email !== 'waheeddar8@gmail.com') {
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

    if (user.email === 'waheeddar8@gmail.com') {
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
      await tx.refund.updateMany({
        where: { initiatedById: id },
        data: { initiatedById: id }, // Can't delete these if they reference other bookings
      });
      // For admin refunds on OTHER users' bookings, just nullify won't work (required field).
      // Delete any refunds this user initiated that aren't already covered above.
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

      // 4. Delete wallet and its transactions
      const wallet = await tx.wallet.findUnique({ where: { userId: id } });
      if (wallet) {
        await tx.walletTransaction.deleteMany({ where: { walletId: wallet.id } });
        await tx.wallet.delete({ where: { id: wallet.id } });
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
      // OperatorAssignment and CashPaymentUser have onDelete: Cascade, handled automatically

      // 7. Finally delete the user
      await tx.user.delete({ where: { id } });
    });

    return NextResponse.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Admin user delete error:', error);
    return NextResponse.json({ error: 'Failed to delete user. Please try again.' }, { status: 500 });
  }
}
