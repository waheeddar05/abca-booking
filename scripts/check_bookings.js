const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const ids = ['cmp1icg2x0004ic04e1ji0q0d', 'cmp1ichfr0007ic04zrta69fy'];
  for (const id of ids) {
    const b = await p.booking.findUnique({ where: { id } });
    console.log('---', id);
    console.log(JSON.stringify(b, null, 2));
  }
  // Also look at most recent payment (cmp1gdqo60001l504b5x8wp3y) that was CAPTURED but no bookings
  console.log('=== ALL bookings linked to user, recent ===');
  const recent = await p.booking.findMany({
    where: { userId: { not: null } },
    orderBy: { createdAt: 'desc' },
    take: 8,
    select: { id: true, paymentStatus: true, paymentMethod: true, price: true, createdAt: true, centerId: true, assignedMachineId: true, startTime: true, endTime: true }
  });
  for (const b of recent) console.log(b);
  await p.$disconnect();
})();
