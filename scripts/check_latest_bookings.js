const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const ids = ['cmp1icg2x0004ic04e1ji0q0d', 'cmp1ichfr0007ic04zrta69fy'];
  const bks = await p.booking.findMany({
    where: { id: { in: ids } },
    select: { id: true, status: true, paymentMethod: true, paymentStatus: true, machineId: true, pitchType: true, category: true, date: true, userId: true, createdAt: true, price: true, originalPrice: true, startTime: true, endTime: true }
  });
  console.log('--- latest payment bookings ---');
  for (const b of bks) console.log(JSON.stringify(b, null, 2));

  // Find user
  const u = await p.user.findFirst({ where: { email: 'waheed.dar5@gmail.com' }, select: { id: true, email: true } });
  console.log('\nuser:', u);
  if (!u) { await p.$disconnect(); return; }
  const recent = await p.booking.findMany({
    where: { userId: u.id },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { id: true, createdAt: true, status: true, paymentMethod: true, paymentStatus: true, machineId: true, centerId: true, date: true, startTime: true, price: true }
  });
  console.log('\n--- last 10 bookings for user ---');
  for (const b of recent) console.log(b.createdAt.toISOString(), b.id, b.status, b.paymentMethod, b.paymentStatus, 'price=', b.price, 'date=', b.date?.toISOString?.()?.slice(0, 10), b.startTime);
  await p.$disconnect();
})();
