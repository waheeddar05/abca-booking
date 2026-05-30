const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const centers = await p.center.findMany({ select: { id: true, name: true, bookingModel: true } });
  for (const c of centers) {
    console.log('---', c.name, c.id, c.bookingModel);
    const policies = await p.centerPolicy.findMany({ where: { centerId: c.id }, select: { key: true, value: true } });
    for (const pol of policies) {
      console.log('  ', pol.key, '=', JSON.stringify(pol.value));
    }
  }
  console.log('=== GLOBAL ===');
  const globals = await p.policy.findMany({ select: { key: true, value: true } });
  for (const g of globals) console.log('  ', g.key, '=', JSON.stringify(g.value));
  await p.$disconnect();
})();
