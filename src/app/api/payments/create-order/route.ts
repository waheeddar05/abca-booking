import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';
import {
  createRazorpayOrder,
  isPaymentEnabled,
  isSlotPaymentRequired,
  isPackagePaymentRequired,
} from '@/lib/razorpay';

// POST /api/payments/create-order
export async function POST(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const enabled = await isPaymentEnabled();
    if (!enabled) {
      return NextResponse.json({ error: 'Payment gateway is not enabled' }, { status: 400 });
    }

    const body = await req.json();
    const { type, amount, packageId, slots, metadata } = body as {
      type: 'SLOT_BOOKING' | 'PACKAGE_PURCHASE';
      amount: number;
      packageId?: string;
      slots?: Array<{ date: string; startTime: string; endTime: string }>;
      metadata?: Record<string, string>;
    };

    if (!type || !amount || amount <= 0) {
      return NextResponse.json({ error: 'Invalid payment type or amount' }, { status: 400 });
    }

    // Validate based on type
    if (type === 'PACKAGE_PURCHASE') {
      const required = await isPackagePaymentRequired();
      if (!required) {
        return NextResponse.json({ error: 'Payment not required for packages' }, { status: 400 });
      }
      if (!packageId) {
        return NextResponse.json({ error: 'packageId is required for package purchase' }, { status: 400 });
      }
      // Verify package exists and price matches
      const pkg = await prisma.package.findUnique({ where: { id: packageId } });
      if (!pkg || !pkg.isActive) {
        return NextResponse.json({ error: 'Package not found or inactive' }, { status: 404 });
      }
      if (pkg.price !== amount) {
        return NextResponse.json({ error: 'Amount does not match package price' }, { status: 400 });
      }
    }

    if (type === 'SLOT_BOOKING') {
      const required = await isSlotPaymentRequired();
      if (!required) {
        return NextResponse.json({ error: 'Payment not required for slot bookings' }, { status: 400 });
      }
      if (!slots || slots.length === 0) {
        return NextResponse.json({ error: 'Slot details required for booking payment' }, { status: 400 });
      }
    }

    // Generate receipt ID
    const receipt = `rcpt_${type === 'PACKAGE_PURCHASE' ? 'pkg' : 'slot'}_${Date.now()}`;

    // Create Razorpay order
    const razorpayOrder = await createRazorpayOrder({
      amount,
      receipt,
      notes: {
        userId: user.id,
        type,
        ...(packageId ? { packageId } : {}),
        ...(metadata || {}),
      },
    });

    // Create Payment record in DB
    const payment = await prisma.payment.create({
      data: {
        userId: user.id,
        amount,
        currency: 'INR',
        status: 'CREATED',
        paymentType: type,
        razorpayOrderId: razorpayOrder.id,
        bookingIds: [],
        userPackageId: null,
        metadata: {
          receipt,
          packageId: packageId || null,
          slots: slots || null,
          ...metadata,
        },
      },
    });

    return NextResponse.json({
      orderId: razorpayOrder.id,
      paymentId: payment.id,
      amount: razorpayOrder.amount, // in paise
      currency: razorpayOrder.currency,
      keyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
    });
  } catch (error) {
    console.error('Create order error:', error);
    const message = error instanceof Error ? error.message : 'Failed to create payment order';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
