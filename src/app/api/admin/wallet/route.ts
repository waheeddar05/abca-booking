import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth';
import {
  getOrCreateWallet,
  creditWallet,
  debitWallet,
  getWalletTransactions,
} from '@/lib/wallet';
import { notifyWalletCredit } from '@/lib/notifications';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/admin/wallet?userId=xxx — Get a user's wallet details
 */
export async function GET(req: NextRequest) {
  try {
    const admin = await getAuthenticatedUser(req);
    if (!admin || admin.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');
    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    const wallet = await getOrCreateWallet(userId);
    const page = parseInt(searchParams.get('page') || '1');
    const txns = await getWalletTransactions(userId, page, 20);

    return NextResponse.json({
      balance: wallet.balance,
      walletId: wallet.id,
      ...txns,
    });
  } catch (error) {
    console.error('Admin wallet GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/admin/wallet — Admin credit or debit a user's wallet
 * Body: { userId, amount, type: 'CREDIT_ADMIN' | 'DEBIT_ADMIN', description }
 */
export async function POST(req: NextRequest) {
  try {
    const admin = await getAuthenticatedUser(req);
    if (!admin || admin.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { userId, amount, type, description } = await req.json();

    if (!userId || !amount || !type) {
      return NextResponse.json({ error: 'userId, amount, and type are required' }, { status: 400 });
    }

    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      return NextResponse.json({ error: 'Amount must be a positive number' }, { status: 400 });
    }

    const adminName = admin.name || admin.id;
    const desc = description || `${type === 'CREDIT_ADMIN' ? 'Credit' : 'Debit'} by ${adminName}`;

    let result;
    if (type === 'CREDIT_ADMIN') {
      result = await creditWallet(userId, numAmount, 'CREDIT_ADMIN', desc);

      // Send notification for admin credit
      try {
        const notifUser = await prisma.user.findUnique({
          where: { id: userId },
          select: { mobileNumber: true, mobileVerified: true },
        });
        await notifyWalletCredit(userId, {
          amount: numAmount,
          reason: desc,
          newBalance: result.newBalance,
          mobileNumber: notifUser?.mobileVerified ? notifUser.mobileNumber : null,
        });
      } catch (notifErr) {
        console.error('Failed to send wallet credit notification:', notifErr);
      }
    } else if (type === 'DEBIT_ADMIN') {
      result = await debitWallet(userId, numAmount, 'DEBIT_ADMIN', desc);
    } else {
      return NextResponse.json({ error: 'type must be CREDIT_ADMIN or DEBIT_ADMIN' }, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Admin wallet POST error:', error);
    const message = error?.message || 'Internal server error';
    const status = message.includes('Insufficient') ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
