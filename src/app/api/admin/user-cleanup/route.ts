import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';

const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || process.env.INITIAL_ADMIN_EMAIL || 'waheeddar8@gmail.com';

async function requireSuperAdmin(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user || user.role !== 'ADMIN') return null;
  if (!user.email || user.email !== SUPER_ADMIN_EMAIL) return null;
  return user;
}

/**
 * GET /api/admin/user-cleanup?userId=xxx
 * Returns summary of a user's data for cleanup preview
 */
export async function GET(req: NextRequest) {
  try {
    const admin = await requireSuperAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: 'Only super admin can access this' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');
    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        mobileNumber: true,
        role: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Gather counts for the preview
    const [
      allBookings,
      cancelledBookings,
      bookedBookings,
      doneBookings,
      payments,
      refunds,
      packageBookings,
      wallet,
      operatedBookings,
      notifications,
    ] = await Promise.all([
      prisma.booking.count({ where: { userId } }),
      prisma.booking.count({ where: { userId, status: 'CANCELLED' } }),
      prisma.booking.count({ where: { userId, status: 'BOOKED' } }),
      prisma.booking.count({ where: { userId, status: 'DONE' } }),
      prisma.payment.count({ where: { userId } }),
      prisma.refund.count({
        where: { booking: { userId } },
      }),
      prisma.packageBooking.count({
        where: { userPackage: { userId } },
      }),
      prisma.wallet.findUnique({
        where: { userId },
        select: { balance: true, _count: { select: { transactions: true } } },
      }),
      prisma.booking.count({ where: { operatorId: userId } }),
      prisma.notification.count({ where: { userId } }),
    ]);

    return NextResponse.json({
      user,
      summary: {
        allBookings,
        cancelledBookings,
        bookedBookings,
        doneBookings,
        payments,
        refunds,
        packageBookings,
        walletBalance: wallet?.balance ?? 0,
        walletTransactions: wallet?._count?.transactions ?? 0,
        operatedBookings,
        notifications,
      },
    });
  } catch (error) {
    console.error('User cleanup GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/admin/user-cleanup
 * Body: { userId, action, walletAmount?, walletDescription? }
 *
 * Actions:
 * - DELETE_ALL_BOOKINGS: Delete all bookings + related (refunds, package bookings, operator links, payments)
 * - DELETE_CANCELLED_BOOKINGS: Delete only cancelled bookings + their refunds/package bookings
 * - DELETE_BOOKED_BOOKINGS: Delete only active (BOOKED) bookings + their refunds/package bookings
 * - DELETE_DONE_BOOKINGS: Delete only done (DONE) bookings + their refunds/package bookings
 * - DELETE_PAYMENTS: Delete all payments for the user
 * - DELETE_NOTIFICATIONS: Delete all notifications for the user
 * - CLEAN_WALLET: Reset wallet balance to 0, delete all transactions
 * - ADD_WALLET: Credit wallet by walletAmount
 * - SUBTRACT_WALLET: Debit wallet by walletAmount
 * - SET_WALLET: Set wallet to exact walletAmount
 * - FULL_CLEANUP: Delete everything (bookings, payments, refunds, packages, wallet, notifications) but keep the user
 */
export async function POST(req: NextRequest) {
  try {
    const admin = await requireSuperAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: 'Only super admin can perform cleanup' }, { status: 403 });
    }

    const { userId, action, walletAmount, walletDescription } = await req.json();

    if (!userId || !action) {
      return NextResponse.json({ error: 'userId and action are required' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (user.email === SUPER_ADMIN_EMAIL) {
      return NextResponse.json({ error: 'Cannot perform cleanup on super admin' }, { status: 400 });
    }

    switch (action) {
      case 'DELETE_ALL_BOOKINGS':
        return await deleteBookings(userId, undefined);

      case 'DELETE_CANCELLED_BOOKINGS':
        return await deleteBookings(userId, 'CANCELLED');

      case 'DELETE_BOOKED_BOOKINGS':
        return await deleteBookings(userId, 'BOOKED');

      case 'DELETE_DONE_BOOKINGS':
        return await deleteBookings(userId, 'DONE');

      case 'DELETE_PAYMENTS':
        return await deletePayments(userId);

      case 'DELETE_NOTIFICATIONS':
        return await deleteNotifications(userId);

      case 'CLEAN_WALLET':
        return await cleanWallet(userId);

      case 'ADD_WALLET':
        return await modifyWallet(userId, Number(walletAmount), 'add', walletDescription || `Admin credit by super admin`);

      case 'SUBTRACT_WALLET':
        return await modifyWallet(userId, Number(walletAmount), 'subtract', walletDescription || `Admin debit by super admin`);

      case 'SET_WALLET':
        return await setWallet(userId, Number(walletAmount), walletDescription || `Wallet set by super admin`);

      case 'FULL_CLEANUP':
        return await fullCleanup(userId);

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error: unknown) {
    console.error('User cleanup POST error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Delete bookings by status (or all if no status filter)
 */
async function deleteBookings(userId: string, status?: 'CANCELLED' | 'BOOKED' | 'DONE') {
  const result = await prisma.$transaction(async (tx) => {
    const where: { userId: string; status?: 'CANCELLED' | 'BOOKED' | 'DONE' } = { userId };
    if (status) where.status = status;

    const bookings = await tx.booking.findMany({
      where,
      select: { id: true },
    });
    const bookingIds = bookings.map((b) => b.id);

    if (bookingIds.length === 0) {
      return { deleted: 0 };
    }

    // 1. Delete refunds tied to these bookings
    await tx.refund.deleteMany({ where: { bookingId: { in: bookingIds } } });

    // 2. Delete package bookings tied to these bookings
    await tx.packageBooking.deleteMany({ where: { bookingId: { in: bookingIds } } });

    // 3. If any of these bookings are referenced in payments.bookingIds, remove the references
    //    (payments.bookingIds is a String[] — we need to handle this carefully)
    const relatedPayments = await tx.payment.findMany({
      where: { userId },
      select: { id: true, bookingIds: true },
    });

    for (const payment of relatedPayments) {
      const remainingIds = payment.bookingIds.filter((bid) => !bookingIds.includes(bid));
      if (remainingIds.length !== payment.bookingIds.length) {
        await tx.payment.update({
          where: { id: payment.id },
          data: { bookingIds: remainingIds },
        });
      }
    }

    // 4. Clear operatorId on these bookings (in case they were operated)
    //    Actually, we're deleting them, so no need. But let's clear operatorId references
    //    from OTHER bookings that reference this user as operator? No — that's a different concern.

    // 5. Delete the bookings
    const deleteResult = await tx.booking.deleteMany({ where: { id: { in: bookingIds } } });

    return { deleted: deleteResult.count };
  });

  const label = status ? `${status.toLowerCase()} bookings` : 'all bookings';
  return NextResponse.json({
    message: `Deleted ${result.deleted} ${label}`,
    deleted: result.deleted,
  });
}

/**
 * Delete all payments for a user
 */
async function deletePayments(userId: string) {
  const result = await prisma.$transaction(async (tx) => {
    // Delete refunds that reference these payments first
    const payments = await tx.payment.findMany({
      where: { userId },
      select: { id: true },
    });
    const paymentIds = payments.map((p) => p.id);

    if (paymentIds.length > 0) {
      await tx.refund.deleteMany({ where: { paymentId: { in: paymentIds } } });
    }

    const deleteResult = await tx.payment.deleteMany({ where: { userId } });
    return { deleted: deleteResult.count };
  });

  return NextResponse.json({
    message: `Deleted ${result.deleted} payments`,
    deleted: result.deleted,
  });
}

/**
 * Delete all notifications for a user
 */
async function deleteNotifications(userId: string) {
  const result = await prisma.notification.deleteMany({ where: { userId } });
  return NextResponse.json({
    message: `Deleted ${result.count} notifications`,
    deleted: result.count,
  });
}

/**
 * Reset wallet to 0, delete all transactions
 */
async function cleanWallet(userId: string) {
  const result = await prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.findUnique({ where: { userId } });
    if (!wallet) {
      return { previousBalance: 0, transactionsDeleted: 0 };
    }

    const previousBalance = wallet.balance;

    await tx.walletTransaction.deleteMany({ where: { walletId: wallet.id } });
    await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: 0 },
    });

    return {
      previousBalance,
      transactionsDeleted: await tx.walletTransaction.count({ where: { walletId: wallet.id } }),
    };
  });

  return NextResponse.json({
    message: `Wallet cleaned. Previous balance: ₹${result.previousBalance}`,
    ...result,
  });
}

/**
 * Add or subtract from wallet
 */
async function modifyWallet(userId: string, amount: number, operation: 'add' | 'subtract', description: string) {
  if (isNaN(amount) || amount <= 0) {
    return NextResponse.json({ error: 'Amount must be a positive number' }, { status: 400 });
  }

  const result = await prisma.$transaction(async (tx) => {
    // Get or create wallet
    let wallet = await tx.wallet.findUnique({ where: { userId } });
    if (!wallet) {
      wallet = await tx.wallet.create({ data: { userId, balance: 0 } });
    }

    const previousBalance = wallet.balance;
    let newBalance: number;
    let txnType: 'CREDIT_ADMIN' | 'DEBIT_ADMIN';

    if (operation === 'add') {
      newBalance = previousBalance + amount;
      txnType = 'CREDIT_ADMIN';
    } else {
      newBalance = previousBalance - amount;
      if (newBalance < 0) newBalance = 0; // Don't go negative
      txnType = 'DEBIT_ADMIN';
    }

    await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: newBalance },
    });

    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: txnType,
        amount,
        balance: newBalance,
        description,
      },
    });

    return { previousBalance, newBalance };
  });

  return NextResponse.json({
    message: `Wallet ${operation === 'add' ? 'credited' : 'debited'} ₹${amount}. Balance: ₹${result.previousBalance} → ₹${result.newBalance}`,
    ...result,
  });
}

/**
 * Set wallet to an exact amount
 */
async function setWallet(userId: string, amount: number, description: string) {
  if (isNaN(amount) || amount < 0) {
    return NextResponse.json({ error: 'Amount must be a non-negative number' }, { status: 400 });
  }

  const result = await prisma.$transaction(async (tx) => {
    let wallet = await tx.wallet.findUnique({ where: { userId } });
    if (!wallet) {
      wallet = await tx.wallet.create({ data: { userId, balance: 0 } });
    }

    const previousBalance = wallet.balance;
    const diff = amount - previousBalance;

    await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: amount },
    });

    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: diff >= 0 ? 'CREDIT_ADMIN' : 'DEBIT_ADMIN',
        amount: Math.abs(diff),
        balance: amount,
        description,
      },
    });

    return { previousBalance, newBalance: amount };
  });

  return NextResponse.json({
    message: `Wallet set to ₹${amount}. Previous: ₹${result.previousBalance}`,
    ...result,
  });
}

/**
 * Full cleanup: delete everything but keep the user
 */
async function fullCleanup(userId: string) {
  const result = await prisma.$transaction(async (tx) => {
    // 1. Get all bookings
    const bookings = await tx.booking.findMany({
      where: { userId },
      select: { id: true },
    });
    const bookingIds = bookings.map((b) => b.id);

    // 2. Delete refunds on user's bookings
    let refundsDeleted = 0;
    if (bookingIds.length > 0) {
      const r = await tx.refund.deleteMany({ where: { bookingId: { in: bookingIds } } });
      refundsDeleted = r.count;
    }

    // 3. Delete refunds initiated by this user on other bookings
    const adminRefunds = await tx.refund.deleteMany({ where: { initiatedById: userId } });
    refundsDeleted += adminRefunds.count;

    // 4. Get user packages and clean up
    const userPackages = await tx.userPackage.findMany({
      where: { userId },
      select: { id: true },
    });
    const userPackageIds = userPackages.map((up) => up.id);

    let packageBookingsDeleted = 0;
    let auditLogsDeleted = 0;
    if (userPackageIds.length > 0) {
      const pb = await tx.packageBooking.deleteMany({ where: { userPackageId: { in: userPackageIds } } });
      packageBookingsDeleted = pb.count;
      const al = await tx.packageAuditLog.deleteMany({ where: { userPackageId: { in: userPackageIds } } });
      auditLogsDeleted = al.count;
    }

    // 5. Also delete any package bookings tied to user's bookings (in case of cross-reference)
    if (bookingIds.length > 0) {
      const pbExtra = await tx.packageBooking.deleteMany({ where: { bookingId: { in: bookingIds } } });
      packageBookingsDeleted += pbExtra.count;
    }

    // 6. Delete wallet and transactions
    let walletCleaned = false;
    let previousBalance = 0;
    const wallet = await tx.wallet.findUnique({ where: { userId } });
    if (wallet) {
      previousBalance = wallet.balance;
      await tx.walletTransaction.deleteMany({ where: { walletId: wallet.id } });
      await tx.wallet.delete({ where: { id: wallet.id } });
      walletCleaned = true;
    }

    // 7. Nullify operatorId on bookings operated by this user
    const operatorCleared = await tx.booking.updateMany({
      where: { operatorId: userId },
      data: { operatorId: null },
    });

    // 8. Delete user packages
    const userPkgResult = await tx.userPackage.deleteMany({ where: { userId } });

    // 10. Delete notifications
    const notifResult = await tx.notification.deleteMany({ where: { userId } });

    // 11. Delete payments
    const paymentResult = await tx.payment.deleteMany({ where: { userId } });

    // 12. Delete bookings
    let bookingsDeleted = 0;
    if (bookingIds.length > 0) {
      const bResult = await tx.booking.deleteMany({ where: { id: { in: bookingIds } } });
      bookingsDeleted = bResult.count;
    }

    // 13. Delete OTPs
    await tx.otp.deleteMany({ where: { userId } });

    return {
      bookingsDeleted,
      refundsDeleted,
      packageBookingsDeleted,
      auditLogsDeleted,
      userPackagesDeleted: userPkgResult.count,
      paymentsDeleted: paymentResult.count,
      notificationsDeleted: notifResult.count,
      walletCleaned,
      previousBalance,
      operatorLinksCleared: operatorCleared.count,
    };
  });

  return NextResponse.json({
    message: 'Full cleanup completed',
    ...result,
  });
}
