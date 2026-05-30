// One-off: check WALLET_ENABLED policy and recent payment attempts on UAT
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

(async () => {
  try {
    const centers = await prisma.center.findMany({
      select: { id: true, name: true, slug: true, bookingModel: true, razorpayKeyId: true },
    });
    console.log('CENTERS:');
    for (const c of centers) console.log(' -', c.slug, c.name, c.bookingModel, 'rzpKey=' + (c.razorpayKeyId ? c.razorpayKeyId.slice(0, 12) + '…' : 'null'));

    console.log('\nWALLET_ENABLED policy:');
    const globalWallet = await prisma.policy.findUnique({ where: { key: 'WALLET_ENABLED' } });
    console.log(' Global Policy WALLET_ENABLED:', globalWallet?.value ?? '(missing)');
    const centerPolicies = await prisma.centerPolicy.findMany({ where: { key: 'WALLET_ENABLED' } });
    for (const cp of centerPolicies) {
      const c = centers.find(x => x.id === cp.centerId);
      console.log(' CenterPolicy', c?.slug || cp.centerId, 'WALLET_ENABLED =', cp.value);
    }

    console.log('\nPAYMENT_GATEWAY_ENABLED:');
    const globalPg = await prisma.policy.findUnique({ where: { key: 'PAYMENT_GATEWAY_ENABLED' } });
    console.log(' Global:', globalPg?.value ?? '(missing)');
    const cpPg = await prisma.centerPolicy.findMany({ where: { key: 'PAYMENT_GATEWAY_ENABLED' } });
    for (const cp of cpPg) {
      const c = centers.find(x => x.id === cp.centerId);
      console.log(' CenterPolicy', c?.slug || cp.centerId, '=', cp.value);
    }

    console.log('\nSLOT_PAYMENT_REQUIRED:');
    const globalSr = await prisma.policy.findUnique({ where: { key: 'SLOT_PAYMENT_REQUIRED' } });
    console.log(' Global:', globalSr?.value ?? '(missing)');
    const cpSr = await prisma.centerPolicy.findMany({ where: { key: 'SLOT_PAYMENT_REQUIRED' } });
    for (const cp of cpSr) {
      const c = centers.find(x => x.id === cp.centerId);
      console.log(' CenterPolicy', c?.slug || cp.centerId, '=', cp.value);
    }

    console.log('\nLatest payments (last 10):');
    const pays = await prisma.payment.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true, centerId: true, status: true, amount: true, paymentType: true,
        razorpayOrderId: true, razorpayPaymentId: true, createdAt: true,
        bookingIds: true, failureReason: true,
      },
    });
    for (const p of pays) {
      const c = centers.find(x => x.id === p.centerId);
      console.log(
        ` ${p.createdAt.toISOString()} ${c?.slug || p.centerId} ${p.paymentType} ${p.status} ₹${p.amount/100} order=${p.razorpayOrderId} bookings=${p.bookingIds.length} fail=${(p.failureReason||'').slice(0,60)}`,
      );
    }
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
})();
