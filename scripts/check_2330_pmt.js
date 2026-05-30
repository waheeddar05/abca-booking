const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const row = await p.payment.findUnique({
    where: { id: 'cmp1ibfxh0001kw04i22ltder' },
  });
  console.log(JSON.stringify({
    id: row.id, status: row.status, razorpaySignature: row.razorpaySignature,
    razorpayPaymentId: row.razorpayPaymentId, bookingIds: row.bookingIds,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  }, null, 2));
  await p.$disconnect();
})();
