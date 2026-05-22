const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const payments = await p.payment.findMany({
    where: { paymentType: 'SLOT_BOOKING' },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      id: true, razorpayOrderId: true, razorpayPaymentId: true,
      status: true, amount: true, centerId: true, userId: true,
      createdAt: true, bookingIds: true, metadata: true, refundAmount: true, refundedAt: true, refundMethod: true, refundId: true, failureReason: true,
      center: { select: { name: true, bookingModel: true } },
      user: { select: { email: true, name: true } },
    }
  });
  for (const pmt of payments) {
    console.log('---');
    console.log('id:', pmt.id);
    console.log('center:', pmt.center?.name, '/', pmt.center?.bookingModel);
    console.log('user:', pmt.user?.email);
    console.log('amount:', pmt.amount, 'status:', pmt.status);
    console.log('razorpay:', pmt.razorpayOrderId, pmt.razorpayPaymentId);
    console.log('bookingIds:', pmt.bookingIds);
    console.log('createdAt:', pmt.createdAt);
    console.log('metadata:', JSON.stringify(pmt.metadata));
    if (pmt.refundAmount) console.log('refund:', pmt.refundAmount, pmt.refundMethod, pmt.refundId, pmt.refundedAt);
    if (pmt.failureReason) console.log('failureReason:', pmt.failureReason);
  }
  await p.$disconnect();
})();
