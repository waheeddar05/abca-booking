const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const centers = await p.center.findMany({ select: { id: true, name: true, slug: true, bookingModel: true } });
  console.log('CENTERS:', centers);

  for (const c of centers) {
    const policies = await p.centerPolicy.findMany({
      where: { centerId: c.id, key: { in: ['WALLET_ENABLED', 'CASH_PAYMENT_ENABLED', 'PAYMENT_GATEWAY_ENABLED', 'SLOT_PAYMENT_REQUIRED'] } },
      select: { key: true, value: true }
    });
    console.log(`\n${c.name} (${c.slug}) policies:`, policies);
  }

  const globalPols = await p.policy.findMany({
    where: { key: { in: ['WALLET_ENABLED', 'CASH_PAYMENT_ENABLED', 'PAYMENT_GATEWAY_ENABLED', 'SLOT_PAYMENT_REQUIRED'] } },
    select: { key: true, value: true }
  });
  console.log('\nGLOBAL:', globalPols);

  await p.$disconnect();
})();
