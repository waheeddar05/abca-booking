const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const pmt = await p.payment.findUnique({
    where: { id: 'cmp1ibfxh0001kw04i22ltder' },
    select: { id: true, status: true, bookingIds: true, metadata: true, amount: true, razorpayPaymentId: true, refundAmount: true, failureReason: true }
  });
  console.log('LATEST PAYMENT (23:30 IST):', JSON.stringify(pmt, null, 2));

  const bookings = await p.booking.findMany({
    where: { id: { in: pmt.bookingIds } },
    select: { id: true, status: true, paymentStatus: true, paymentMethod: true, category: true, date: true, startTime: true, endTime: true, createdAt: true, machineId: true, pitchType: true, price: true, assignedMachineId: true }
  });
  console.log('\nBOOKINGS:', JSON.stringify(bookings, null, 2));

  const stuck = await p.payment.findUnique({
    where: { id: 'cmp1gdqo60001l504b5x8wp3y' },
    select: { id: true, status: true, bookingIds: true, refundAmount: true, refundedAt: true, failureReason: true, createdAt: true }
  });
  console.log('\nSTUCK 22:35 IST:', JSON.stringify(stuck, null, 2));

  await p.$disconnect();
})();
