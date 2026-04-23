import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/adminAuth';
import { getISTTodayUTC, getISTLastMonthRange, dateStringToUTC } from '@/lib/time';

export async function GET(req: NextRequest) {
  try {
    const session = await requireAdmin(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const fromParam = searchParams.get('from');
    const toParam = searchParams.get('to');

    // Build date filter for queries
    const dateFilter: Record<string, Date> = {};
    if (fromParam) dateFilter.gte = dateStringToUTC(fromParam);
    if (toParam) dateFilter.lte = dateStringToUTC(toParam);
    const hasDateFilter = Object.keys(dateFilter).length > 0;

    const todayUTC = getISTTodayUTC();
    const lastMonthRange = getISTLastMonthRange();

    // Run ALL queries in a single Promise.all for maximum parallelism
    const [
      totalBookings,
      activeAdmins,
      todayBookings,
      upcomingBookings,
      lastMonthBookings,
      totalSlots,
      bookingRevenueValue,
      totalDiscountValue,
      packageRevenueValue,
      machineRevenue,
      selfOperatedBookings,
      unassignedBookings,
      operatorSummary,
    ] = await Promise.all([
      prisma.booking.count({
        where: {
          status: { not: 'CANCELLED' },
          ...(hasDateFilter ? { date: dateFilter } : {}),
        },
      }),
      prisma.user.count({ where: { role: 'ADMIN' } }),
      prisma.booking.count({
        where: { date: todayUTC, status: { not: 'CANCELLED' } },
      }),
      prisma.booking.count({
        where: { date: { gt: todayUTC }, status: 'BOOKED' },
      }),
      prisma.booking.count({
        where: {
          date: {
            gte: lastMonthRange.start,
            lte: lastMonthRange.end,
          },
          status: { not: 'CANCELLED' },
        },
      }),
      prisma.slot.count().catch(() => 0),
      // Booking revenue — mirrors the bookings CSV export exactly:
      //   Revenue = Σ(Amount column) − Σ(Refund Amount column)
      // where per-row Amount = regular ? price : (extraCharge + kitRentalCharge)
      // and per-row Refund Amount = regular ? Σ(refund.amount where status!='FAILED') : 0.
      // No Math.max clamp, no isSuperAdminBooking filter — we match the CSV 1:1.
      (async () => {
        try {
          const bookings = await prisma.booking.findMany({
            where: hasDateFilter ? { date: dateFilter } : {},
            select: {
              price: true,
              kitRentalCharge: true,
              packageBooking: { select: { extraCharge: true } },
              refunds: { select: { amount: true, status: true } },
            },
          });
          let paid = 0;
          let refunded = 0;
          for (const b of bookings) {
            const isPkg = !!b.packageBooking;
            if (isPkg) {
              paid += (b.packageBooking?.extraCharge || 0) + (b.kitRentalCharge || 0);
              // Package bookings: Refund Amount column is 'NA' in CSV, so contribute 0.
            } else {
              paid += b.price || 0;
              for (const r of b.refunds) {
                if (r.status !== 'FAILED') refunded += r.amount;
              }
            }
          }
          return paid - refunded;
        } catch {
          return 0;
        }
      })(),
      // Discount
      prisma.booking.aggregate({
        _sum: { discountAmount: true },
        where: {
          status: { in: ['BOOKED', 'DONE'] },
          isSuperAdminBooking: false,
          discountAmount: { gt: 0 },
          ...(hasDateFilter ? { date: dateFilter } : {}),
        },
      }).then(r => r._sum.discountAmount || 0).catch(() => 0),
      // Package revenue — mirrors the packages CSV export exactly:
      //   Revenue = Σ(Amount Paid) − Σ(Refunded Amount)
      // Date filter keyed by activationDate (same as the CSV export). No clamp.
      (async () => {
        try {
          const ups = await prisma.userPackage.findMany({
            where: hasDateFilter ? { activationDate: dateFilter } : {},
            select: { id: true, amountPaid: true },
          });
          if (ups.length === 0) return 0;
          const refundRows = await prisma.walletTransaction.findMany({
            where: {
              type: 'CREDIT_REFUND',
              referenceId: { in: ups.map(u => u.id) },
            },
            select: { referenceId: true, amount: true },
          });
          const refundById = new Map<string, number>();
          for (const r of refundRows) {
            if (!r.referenceId) continue;
            refundById.set(r.referenceId, (refundById.get(r.referenceId) || 0) + r.amount);
          }
          let paid = 0;
          let refunded = 0;
          for (const up of ups) {
            paid += up.amountPaid;
            refunded += refundById.get(up.id) || 0;
          }
          return paid - refunded;
        } catch {
          return 0;
        }
      })(),
      // Machine-wise revenue — uses the same per-booking Amount / Refund Amount
      // logic as the bookings CSV export, grouped by machineId. No clamp.
      (async () => {
        try {
          const bookings = await prisma.booking.findMany({
            where: {
              machineId: { not: null },
              ...(hasDateFilter ? { date: dateFilter } : {}),
            },
            select: {
              machineId: true,
              price: true,
              kitRentalCharge: true,
              packageBooking: { select: { extraCharge: true } },
              refunds: { select: { amount: true, status: true } },
            },
          });
          const byMachine = new Map<string, number>();
          for (const b of bookings) {
            const mid = b.machineId as string;
            const isPkg = !!b.packageBooking;
            let net = 0;
            if (isPkg) {
              net += (b.packageBooking?.extraCharge || 0) + (b.kitRentalCharge || 0);
            } else {
              net += b.price || 0;
              for (const r of b.refunds) {
                if (r.status !== 'FAILED') net -= r.amount;
              }
            }
            byMachine.set(mid, (byMachine.get(mid) || 0) + net);
          }
          return Array.from(byMachine.entries()).map(([machineId, price]) => ({
            machineId,
            _sum: { price },
          }));
        } catch {
          return [];
        }
      })(),
      // Self-operated bookings
      prisma.booking.count({
        where: {
          status: { not: 'CANCELLED' },
          operationMode: 'SELF_OPERATE',
          ...(hasDateFilter ? { date: dateFilter } : {}),
        },
      }).catch(() => 0),
      // Unassigned bookings (WITH_OPERATOR but no operator assigned)
      prisma.booking.count({
        where: {
          status: { not: 'CANCELLED' },
          operationMode: 'WITH_OPERATOR',
          operatorId: null,
          ...(hasDateFilter ? { date: dateFilter } : {}),
        },
      }).catch(() => 0),
      // Operator summary
      prisma.booking.groupBy({
        by: ['operatorId'],
        _count: { _all: true },
        where: {
          status: { not: 'CANCELLED' },
          operatorId: { not: null },
          ...(hasDateFilter ? { date: dateFilter } : {}),
        },
      }).then(async (results) => {
        if (results.length === 0) return [];
        const operatorIds = results.map(r => r.operatorId).filter(Boolean) as string[];
        const operators = await prisma.user.findMany({
          where: { id: { in: operatorIds } },
          select: { id: true, name: true },
        });
        const nameMap = new Map(operators.map(o => [o.id, o.name]));
        return results.map(r => ({
          id: r.operatorId!,
          name: nameMap.get(r.operatorId!) || null,
          bookings: r._count._all,
        }));
      }).catch(() => []),
    ]);

    return NextResponse.json({
      totalBookings,
      activeAdmins,
      todayBookings,
      upcomingBookings,
      lastMonthBookings,
      totalSlots,
      totalRevenue: bookingRevenueValue + packageRevenueValue,
      bookingRevenue: bookingRevenueValue,
      packageRevenue: packageRevenueValue,
      totalDiscount: totalDiscountValue,
      machineRevenue,
      selfOperatedBookings,
      unassignedBookings,
      operatorSummary,
      systemStatus: 'Healthy',
    }, {
      headers: {
        'Cache-Control': 'private, s-maxage=30, stale-while-revalidate=60',
      },
    });
  } catch (error) {
    console.error('Admin stats fetch error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
