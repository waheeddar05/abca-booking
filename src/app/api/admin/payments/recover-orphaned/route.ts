import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';
import { creditWallet } from '@/lib/wallet';

/**
 * POST /api/admin/payments/recover-orphaned
 *
 * Safety net: Find CAPTURED payments with no linked bookings (orphaned)
 * that are older than 15 minutes, and auto-refund them to the user's wallet.
 *
 * This handles edge cases where:
 * - Payment was captured but booking failed and auto-refund didn't trigger
 * - Network disconnection between payment verify and booking creation
 * - Client crashed after payment but before booking
 *
 * Can be called manually by admin or via a scheduled task (cron).
 *
 * Query params:
 *   ?dryRun=true  — only list orphaned payments without refunding
 *   ?minAge=30    — minimum age in minutes (default: 15)
 */
export async function POST(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const dryRun = searchParams.get('dryRun') === 'true';
    const minAgeMinutes = parseInt(searchParams.get('minAge') || '15');

    const cutoff = new Date(Date.now() - minAgeMinutes * 60 * 1000);

    // Find orphaned payments: CAPTURED, type SLOT_BOOKING, no bookingIds, older than cutoff
    const orphanedPayments = await prisma.payment.findMany({
      where: {
        status: 'CAPTURED',
        paymentType: 'SLOT_BOOKING',
        bookingIds: { equals: [] },
        createdAt: { lt: cutoff },
      },
      include: {
        user: { select: { id: true, name: true, email: true, mobileNumber: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (orphanedPayments.length === 0) {
      return NextResponse.json({ message: 'No orphaned payments found', recovered: 0 });
    }

    if (dryRun) {
      return NextResponse.json({
        message: `Found ${orphanedPayments.length} orphaned payment(s) (dry run — no refunds issued)`,
        orphanedPayments: orphanedPayments.map(p => ({
          id: p.id,
          userId: p.userId,
          userName: p.user.name,
          userEmail: p.user.email,
          amount: p.amount,
          razorpayOrderId: p.razorpayOrderId,
          razorpayPaymentId: p.razorpayPaymentId,
          createdAt: p.createdAt,
          ageMinutes: Math.round((Date.now() - p.createdAt.getTime()) / 60000),
        })),
      });
    }

    // Process refunds
    const results: Array<{
      paymentId: string;
      userId: string;
      amount: number;
      status: 'refunded' | 'failed';
      error?: string;
    }> = [];

    for (const payment of orphanedPayments) {
      try {
        const walletResult = await creditWallet(
          payment.userId,
          payment.amount,
          'CREDIT_REFUND',
          `Auto-recovery: orphaned payment refund`,
          payment.id,
        );

        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: 'REFUNDED',
            refundAmount: payment.amount,
            refundedAt: new Date(),
            refundMethod: 'WALLET',
            failureReason: `Orphaned payment — auto-recovered by admin (${user.name || user.id})`,
          },
        });

        results.push({
          paymentId: payment.id,
          userId: payment.userId,
          amount: payment.amount,
          status: 'refunded',
        });

        console.log(`Recovered orphaned payment ${payment.id}: ₹${payment.amount} → wallet for user ${payment.userId}`);
      } catch (err) {
        console.error(`Failed to recover orphaned payment ${payment.id}:`, err);
        results.push({
          paymentId: payment.id,
          userId: payment.userId,
          amount: payment.amount,
          status: 'failed',
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    const recovered = results.filter(r => r.status === 'refunded').length;
    const failed = results.filter(r => r.status === 'failed').length;

    return NextResponse.json({
      message: `Recovered ${recovered} orphaned payment(s)${failed > 0 ? `, ${failed} failed` : ''}`,
      recovered,
      failed,
      results,
    });
  } catch (error) {
    console.error('Recover orphaned payments error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
