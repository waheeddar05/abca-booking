const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const before = await p.centerPolicy.findUnique({
    where: { centerId_key: { centerId: 'ctr_abca', key: 'WALLET_ENABLED' } },
  });
  console.log('Before:', before);

  const row = await p.centerPolicy.upsert({
    where: { centerId_key: { centerId: 'ctr_abca', key: 'WALLET_ENABLED' } },
    create: { centerId: 'ctr_abca', key: 'WALLET_ENABLED', value: 'true' },
    update: { value: 'true' },
  });
  console.log('After:', row);

  await p.$disconnect();
})();
