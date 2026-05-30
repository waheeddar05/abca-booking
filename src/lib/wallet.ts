/**
 * Wallet Service
 *
 * Manages user wallet balance, credits (refunds), and debits (payments).
 * Wallets are CENTER-SCOPED: each user can hold at most one wallet per
 * center, with independent balances. A refund issued at ABCA credits the
 * user's ABCA wallet only; balances cannot be spent across centers.
 *
 * Future option (per WALLET_SCOPE policy = 'GLOBAL') would collapse to
 * one wallet per user — not implemented today.
 *
 * Feature flag: WALLET_ENABLED (Policy table, with optional CenterPolicy
 * override).
 *
 * No expiry on wallet credits.
 */

import { prisma } from '@/lib/prisma';
import { isPolicyEnabled, getPolicyValue } from '@/lib/policy';
import type { WalletTransactionType } from '@prisma/client';

// ─── Types ──────────────────────────────────────────────────────────

export interface WalletInfo {
  id: string;
  userId: string;
  centerId: string;
  balance: number;
}

export interface WalletTransactionResult {
  transactionId: string;
  type: WalletTransactionType;
  amount: number;
  newBalance: number;
}

// ─── Feature Flag ───────────────────────────────────────────────────

/**
 * Whether wallet feature is enabled at the given center.
 * Falls back to the global Policy row.
 */
export async function isWalletEnabled(centerId: string): Promise<boolean> {
  return isPolicyEnabled('WALLET_ENABLED', centerId, false);
}

// ─── Core Functions ─────────────────────────────────────────────────

/**
 * Get or create a wallet for a (user, center) pair.
 * Wallets are lazily created on first access.
 */
export async function getOrCreateWallet(userId: string, centerId: string): Promise<WalletInfo> {
  const wallet = await prisma.wallet.upsert({
    where: { userId_centerId: { userId, centerId } },
    create: { userId, centerId, balance: 0 },
    update: {}, // no-op if exists
    select: { id: true, userId: true, centerId: true, balance: true },
  });
  return wallet;
}

/**
 * Get wallet balance for a user at a center. Returns 0 if no wallet exists.
 */
export async function getWalletBalance(userId: string, centerId: string): Promise<number> {
  const wallet = await prisma.wallet.findUnique({
    where: { userId_centerId: { userId, centerId } },
    select: { balance: true },
  });
  return wallet?.balance ?? 0;
}

/**
 * Credit amount to user's wallet at a center (e.g., refund).
 * Uses a transaction to ensure atomicity.
 */
export async function creditWallet(
  userId: string,
  centerId: string,
  amount: number,
  type: 'CREDIT_REFUND' | 'CREDIT_ADMIN',
  description: string,
  referenceId?: string,
): Promise<WalletTransactionResult> {
  if (amount <= 0) throw new Error('Credit amount must be positive');

  return prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.upsert({
      where: { userId_centerId: { userId, centerId } },
      create: { userId, centerId, balance: 0 },
      update: {},
    });

    const newBalance = wallet.balance + amount;

    await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: newBalance },
    });

    const txn = await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type,
        amount,
        balance: newBalance,
        description,
        referenceId,
      },
    });

    return {
      transactionId: txn.id,
      type: txn.type,
      amount,
      newBalance,
    };
  });
}

/**
 * Debit amount from user's wallet at a center (e.g., booking payment).
 * Throws if no wallet exists or balance is insufficient.
 */
export async function debitWallet(
  userId: string,
  centerId: string,
  amount: number,
  type: 'DEBIT_BOOKING' | 'DEBIT_ADMIN',
  description: string,
  referenceId?: string,
): Promise<WalletTransactionResult> {
  if (amount <= 0) throw new Error('Debit amount must be positive');

  return prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.findUnique({
      where: { userId_centerId: { userId, centerId } },
    });

    if (!wallet) throw new Error('Wallet not found');
    if (wallet.balance < amount) throw new Error('Insufficient wallet balance');

    const newBalance = wallet.balance - amount;

    await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: newBalance },
    });

    const txn = await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type,
        amount,
        balance: newBalance,
        description,
        referenceId,
      },
    });

    return {
      transactionId: txn.id,
      type: txn.type,
      amount,
      newBalance,
    };
  });
}

/**
 * Roll back a wallet debit (e.g., if Razorpay payment fails after wallet debit).
 * Credits back the amount to the same wallet (same center).
 */
export async function rollbackWalletDebit(
  userId: string,
  centerId: string,
  amount: number,
  originalTransactionId: string,
): Promise<WalletTransactionResult> {
  return creditWallet(
    userId,
    centerId,
    amount,
    'CREDIT_REFUND',
    `Rollback: payment failed (ref: ${originalTransactionId})`,
    originalTransactionId,
  );
}

/**
 * Get wallet transactions for a user at a center, with pagination.
 */
export async function getWalletTransactions(
  userId: string,
  centerId: string,
  page = 1,
  limit = 20,
): Promise<{
  transactions: Array<{
    id: string;
    type: WalletTransactionType;
    amount: number;
    balance: number;
    description: string | null;
    referenceId: string | null;
    createdAt: Date;
  }>;
  pagination: { page: number; limit: number; total: number; totalPages: number };
}> {
  const wallet = await prisma.wallet.findUnique({
    where: { userId_centerId: { userId, centerId } },
    select: { id: true },
  });

  if (!wallet) {
    return {
      transactions: [],
      pagination: { page, limit, total: 0, totalPages: 0 },
    };
  }

  const skip = (page - 1) * limit;

  const [transactions, total] = await Promise.all([
    prisma.walletTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      select: {
        id: true,
        type: true,
        amount: true,
        balance: true,
        description: true,
        referenceId: true,
        createdAt: true,
      },
    }),
    prisma.walletTransaction.count({ where: { walletId: wallet.id } }),
  ]);

  return {
    transactions,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/**
 * Sum of wallet balances across all of a user's wallets (every center).
 * Useful for the user dashboard summary while we still ship a single
 * "wallet balance" widget. Phase 4 will replace this with a per-center
 * breakdown in the UI.
 */
export async function getTotalUserWalletBalance(userId: string): Promise<number> {
  const wallets = await prisma.wallet.findMany({
    where: { userId },
    select: { balance: true },
  });
  return wallets.reduce((sum, w) => sum + w.balance, 0);
}

/**
 * Get the admin-configured default refund method for a given center.
 * Returns 'WALLET' (default) or 'RAZORPAY'. Per-center override
 * supported via CenterPolicy('DEFAULT_REFUND_METHOD').
 */
export async function getDefaultRefundMethod(centerId: string): Promise<'WALLET' | 'RAZORPAY'> {
  const val = await getPolicyValue('DEFAULT_REFUND_METHOD', centerId);
  return val === 'RAZORPAY' ? 'RAZORPAY' : 'WALLET';
}
