const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const abca = await p.center.findFirst({ where: { slug: 'abca' }, select: { id: true, name: true, bookingModel: true } });
  console.log('abca:', abca);
  if (abca) {
    const pols = await p.centerPolicy.findMany({ where: { centerId: abca.id, key: { in: ['PAYMENT_GATEWAY_ENABLED','SLOT_PAYMENT_REQUIRED','WALLET_ENABLED','CASH_PAYMENT_ENABLED'] } } });
    console.log('abca center policies (payment-related):');
    for (const pol of pols) console.log(`  ${pol.key} =>`, JSON.stringify(pol.value));
  }
  const u = await p.user.findFirst({ where: { email: 'waheed.dar5@gmail.com' }, select: { id: true, role: true, isSuperAdmin: true, isFreeUser: true, isBlacklisted: true } });
  console.log('\nuser waheed.dar5@gmail.com:', u);
  await p.$disconnect();
})();
