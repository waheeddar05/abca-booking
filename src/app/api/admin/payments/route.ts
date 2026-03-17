import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';

// GET /api/admin/payments - List all payments with filtering
export async function GET(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const status = searchParams.get('status');
    const type = searchParams.get('type');
    const userId = searchParams.get('userId');
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    const bookingId = searchParams.get('bookingId');

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (type) where.paymentType = type;
    if (userId) where.userId = userId;
    if (bookingId) where.bookingIds = { has: bookingId };
    if (from || to) {
      where.createdAt = {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(to) } : {}),
      };
    }

    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          user: {
            select: { id: true, name: true, email: true, mobileNumber: true },
          },
        },
      }),
      prisma.payment.count({ where }),
    ]);

    // Summary stats
    const stats = await prisma.payment.aggregate({
      where: { status: 'CAPTURED' },
      _sum: { amount: true, refundAmount: true },
      _count: true,
    });

    return NextResponse.json({
      payments,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      stats: {
        totalCaptured: stats._count,
        totalRevenue: stats._sum.amount || 0,
        totalRefunded: stats._sum.refundAmount || 0,
      },
    });
  } catch (error) {
    console.error('Admin payments error:', error);
    return NextResponse.json({ error: 'Failed to fetch payments' }, { status: 500 });
  }
}

// PATCH /api/admin/payments - Manual refund
export async function PATCH(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { paymentId, action } = body as { paymentId: string; action: 'refund' };

    if (!paymentId || action !== 'refund') {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
    }

    if (payment.status !== 'CAPTURED') {
      return NextResponse.json({ error: 'Can only refund captured payments' }, { status: 400 });
    }

    if (!payment.razorpayPaymentId) {
      return NextResponse.json({ error: 'No Razorpay payment ID to refund' }, { status: 400 });
    }

    // Initiate refund via Razorpay
    const { initiateRefund } = await import('@/lib/razorpay');
    const refund = await initiateRefund({
      paymentId: payment.razorpayPaymentId,
      notes: { refundedBy: user.id, reason: 'Admin initiated refund' },
    });

    // Update payment record
    await prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: 'REFUNDED',
        refundId: refund.id,
        refundAmount: payment.amount,
        refundedAt: new Date(),
      },
    });

    return NextResponse.json({ success: true, refundId: refund.id });
  } catch (error) {
    console.error('Admin refund error:', error);
    const message = error instanceof Error ? error.message : 'Refund failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
