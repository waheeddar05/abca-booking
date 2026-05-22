const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const bookings = await p.booking.findMany({
    where: { id: { in: ['cmp1icg2x0004ic04e1ji0q0d', 'cmp1ichfr0007ic04zrta69fy'] } },
  });
  console.log('latest bookings:');
  for (const b of bookings) console.log(JSON.stringify(b, null, 2));

  const u = await p.user.findFirst({ where: { email: 'waheed.dar5@gmail.com' }, select: { id: true } });
  if (u) {
    const balances = await p.wallet.findMany({ where: { userId: u.id }, include: { center: { select: { name: true } } } });
    console.log('\nwallet balances for waheed.dar5:');
    for (const b of balances) console.log(`  center=${b.center?.name} balance=${b.balance}`);
  }

  const topplay = await p.center.findFirst({ where: { name: { contains: 'Top Play', mode: 'insensitive' } }, select: { id: true, name: true, bookingModel: true } });
  console.log('\ntopplay center:', topplay);
  if (topplay) {
    const pols = await p.centerPolicy.findMany({ where: { centerId: topplay.id } });
    console.log('topplay center policies:');
    for (const pol of pols) console.log(`  ${pol.key} =>`, JSON.stringify(pol.value));
    const globals = await p.policy.findMany({ where: { key: { in: ['PAYMENT_GATEWAY_ENABLED','SLOT_PAYMENT_REQUIRED','WALLET_ENABLED','CASH_PAYMENT_ENABLED'] } } });
    console.log('\nglobal policies:');
    for (const pol of globals) console.log(`  ${pol.key} =>`, JSON.stringify(pol.value));
  }
  await p.$disconnect();
})();
