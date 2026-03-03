/**
 * Wallet Service
 *
 * Manages user wallet balance, credits (refunds), and debits (payments).
 * No expiry on wallet credits.
 *
 * Feature flag: WALLET_ENABLED (Policy table)
 */

import { prisma } from '@/lib/prisma';
import { getCachedPolicy } from '@/lib/policy-cache';
import type { Prisma, WalletTransactionType } from '@prisma/client';

// ─── Types ──────────────────────────────────────────────────────────

export interface WalletInfo {
  id: string;
  userId: string;
  balance: number;
}

export interface WalletTransactionResult {
  transactionId: string;
  type: WalletTransactionType;
  amount: number;
  newBalance: number;
}

// ─── Feature Flag ───────────────────────────────────────────────────

export async function isWalletEnabled(): Promise<boolean> {
  const val = await getCachedPolicy('WALLET_ENABLED');
  return val === 'true';
}

// ─── Core Functions ─────────────────────────────────────────────────

/**
 * Get or create a wallet for a user.
 * Wallets are lazily created on first access.
 */
export async function getOrCreateWallet(userId: string): Promise<WalletInfo> {
  const wallet = await prisma.wallet.upsert({
    where: { userId },
    create: { userId, balance: 0 },
    update: {}, // no-op if exists
    select: { id: true, userId: true, balance: true },
  });
  return wallet;
}

/**
 * Get wallet balance for a user. Returns 0 if no wallet exists.
 */
export async function getWalletBalance(userId: string): Promise<number> {
  const wallet = await prisma.wallet.findUnique({
    where: { userId },
    select: { balance: true },
  });
  return wallet?.balance ?? 0;
}

/**
 * Credit amount to user's wallet (e.g., refund).
 * Uses a transaction to ensure atomicity.
 */
export async function creditWallet(
  userId: string,
  amount: number,
  type: 'CREDIT_REFUND' | 'CREDIT_ADMIN',
  description: string,
  referenceId?: string,
): Promise<WalletTransactionResult> {
  if (amount <= 0) throw new Error('Credit amount must be positive');

  return prisma.$transaction(async (tx) => {
    // Get or create wallet
    const wallet = await tx.wallet.upsert({
      where: { userId },
      create: { userId, balance: 0 },
      update: {},
    });

    const newBalance = wallet.balance + amount;

    // Update balance
    await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: newBalance },
    });

    // Create transaction record
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
 * Debit amount from user's wallet (e.g., booking payment).
 * Throws if insufficient balance.
 * Uses a transaction to ensure atomicity.
 */
export async function debitWallet(
  userId: string,
  amount: number,
  type: 'DEBIT_BOOKING' | 'DEBIT_ADMIN',
  description: string,
  referenceId?: string,
): Promise<WalletTransactionResult> {
  if (amount <= 0) throw new Error('Debit amount must be positive');

  return prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.findUnique({
      where: { userId },
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
 * Credits back the amount to the wallet.
 */
export async function rollbackWalletDebit(
  userId: string,
  amount: number,
  originalTransactionId: string,
): Promise<WalletTransactionResult> {
  return creditWallet(
    userId,
    amount,
    'CREDIT_REFUND',
    `Rollback: payment failed (ref: ${originalTransactionId})`,
    originalTransactionId,
  );
}

/**
 * Get wallet transactions for a user with pagination.
 */
export async function getWalletTransactions(
  userId: string,
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
    where: { userId },
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
 * Get the admin-configured default refund method.
 * Returns 'WALLET' (default) or 'RAZORPAY'.
 */
export async function getDefaultRefundMethod(): Promise<'WALLET' | 'RAZORPAY'> {
  const val = await getCachedPolicy('DEFAULT_REFUND_METHOD');
  return val === 'RAZORPAY' ? 'RAZORPAY' : 'WALLET';
}
