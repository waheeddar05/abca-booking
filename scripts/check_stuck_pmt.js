const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const row = await p.payment.findUnique({
    where: { id: 'cmp1gdqo60001l504b5x8wp3y' },
  });
  console.log(JSON.stringify(row, null, 2));
  await p.$disconnect();
})();
