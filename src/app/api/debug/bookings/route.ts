import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// TEMPORARY debug endpoint - remove after debugging
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret');
  if (secret !== 'debug-refund-2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const total = await prisma.booking.count();
    const withPrice = await prisma.booking.count({ where: { price: { gt: 0 } } });
    const packageCount = await prisma.booking.count({
      where: { packageBooking: { isNot: null } },
    });

    // Get 10 most recent bookings with refund-relevant fields
    let bookings: any[];
    let queryType = 'primary';
    try {
      bookings = await prisma.booking.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: {
          packageBooking: { select: { id: true } },
          refunds: { select: { id: true, amount: true, method: true, status: true } },
        },
      });
    } catch (e: any) {
      queryType = 'fallback: ' + e.message;
      bookings = await prisma.booking.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          price: true,
          paymentMethod: true,
          status: true,
          playerName: true,
          date: true,
        },
      });
    }

    const analyzed = bookings.map((b: any) => {
      const canRefund = (() => {
        if (b.packageBooking) return 'NO:packageBooking';
        if (!b.price || b.price <= 0) return `NO:price=${b.price}`;
        const refunds = b.refunds || [];
        const totalRefunded = refunds.reduce(
          (sum: number, r: any) => (r.status !== 'FAILED' ? sum + r.amount : sum),
          0
        );
        if (totalRefunded >= b.price) return `NO:fullyRefunded(${totalRefunded}/${b.price})`;
        return `YES(remaining:${b.price - totalRefunded})`;
      })();

      return {
        id: b.id?.slice(-8),
        price: b.price,
        paymentMethod: b.paymentMethod,
        status: b.status,
        playerName: b.playerName,
        hasPackageBooking: b.packageBooking !== undefined ? !!b.packageBooking : 'N/A',
        refundsCount: b.refunds !== undefined ? b.refunds.length : 'N/A',
        canRefund,
      };
    });

    return NextResponse.json({
      totalBookings: total,
      bookingsWithPrice: withPrice,
      packageBookings: packageCount,
      queryType,
      bookings: analyzed,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
