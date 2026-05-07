import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/adminAuth';
import { getAuthenticatedUser } from '@/lib/auth';
import { resolveCurrentCenter } from '@/lib/centers';
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
    const allCenters = searchParams.get('allCenters') === 'true';

    // Build date filter for queries
    const dateFilter: Record<string, Date> = {};
    if (fromParam) dateFilter.gte = dateStringToUTC(fromParam);
    if (toParam) dateFilter.lte = dateStringToUTC(toParam);
    const hasDateFilter = Object.keys(dateFilter).length > 0;

    // Center scope. The dashboard shows the current center's numbers
    // unless the super admin asks for the platform aggregate.
    const adminUser = await getAuthenticatedUser(req);
    const center = adminUser ? await resolveCurrentCenter(req, adminUser) : null;
    let centerId: string | null = null;
    if (!allCenters && center) {
      centerId = center.id;
    } else if (!allCenters && !center) {
      return NextResponse.json({ error: 'No center selected' }, { status: 400 });
    } else if (allCenters && !adminUser?.isSuperAdmin) {
      return NextResponse.json({ error: 'allCenters requires super admin' }, { status: 403 });
    }
    const centerFilter: { centerId?: string } = centerId ? { centerId } : {};

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
      revenueBreakdown,
      selfOperatedBookings,
      unassignedBookings,
      operatorSummary,
    ] = await Promise.all([
      prisma.booking.count({
        where: {
          ...centerFilter,
          status: { not: 'CANCELLED' },
          ...(hasDateFilter ? { date: dateFilter } : {}),
        },
      }),
      // "Active admins" = ADMIN users at this center (or globally for super admin platform view).
      centerId
        ? prisma.centerMembership.count({ where: { centerId, role: 'ADMIN', isActive: true } })
        : prisma.user.count({ where: { role: 'ADMIN' } }),
      prisma.booking.count({
        where: { ...centerFilter, date: todayUTC, status: { not: 'CANCELLED' } },
      }),
      prisma.booking.count({
        where: { ...centerFilter, date: { gt: todayUTC }, status: 'BOOKED' },
      }),
      prisma.booking.count({
        where: {
          ...centerFilter,
          date: {
            gte: lastMonthRange.start,
            lte: lastMonthRange.end,
          },
          status: { not: 'CANCELLED' },
        },
      }),
      prisma.slot.count({ where: centerFilter }).catch(() => 0),
      // Booking revenue — mirrors the bookings CSV export exactly:
      //   Revenue = Σ(Amount column) − Σ(Refund Amount column)
      // where per-row Amount = regular ? price : (extraCharge + kitRentalCharge)
      // and per-row Refund Amount = regular ? Σ(refund.amount where status!='FAILED') : 0.
      // No Math.max clamp, no isSuperAdminBooking filter — we match the CSV 1:1.
      (async () => {
        try {
          const bookings = await prisma.booking.findMany({
            where: { ...centerFilter, ...(hasDateFilter ? { date: dateFilter } : {}) },
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
          ...centerFilter,
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
            where: {
              ...(centerId ? { package: { centerId } } : {}),
              ...(hasDateFilter ? { activationDate: dateFilter } : {}),
            },
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
      // Revenue breakdown — same per-booking net (price - non-FAILED
       // refunds; package = extraCharge + kitRental) as the CSV export.
       //
       // Axis depends on the center's booking model:
       //  - MACHINE_PITCH: group by legacy `machineId` enum (ABCA shape).
       //  - RESOURCE_BASED: group by `category` (MACHINE / SIDEARM /
       //    COACHING / FULL_COURT / NET / CORPORATE_BATCH). RESOURCE_BASED
       //    bookings rarely set `machineId`, so machine-grouping here was
       //    returning an empty chart at Toplay.
       //
       // For the platform-wide super-admin view (no centerId), we keep
       // the legacy `machineId` axis since that's the only field shared
       // across both models — RESOURCE_BASED rows just don't contribute.
      (async () => {
        try {
          let groupBy: 'machineId' | 'category' = 'machineId';
          if (centerId) {
            const c = await prisma.center.findUnique({
              where: { id: centerId },
              select: { bookingModel: true },
            });
            if (c?.bookingModel === 'RESOURCE_BASED') groupBy = 'category';
          }

          if (groupBy === 'machineId') {
            const bookings = await prisma.booking.findMany({
              where: {
                ...centerFilter,
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
            return {
              axis: 'machine' as const,
              entries: Array.from(byMachine.entries()).map(([machineId, price]) => ({
                key: machineId,
                machineId,
                _sum: { price },
              })),
            };
          }

          // RESOURCE_BASED: group by booking category. `category` is
          // non-null in the schema (defaults to MACHINE for back-compat),
          // so no filter is needed.
          const bookings = await prisma.booking.findMany({
            where: {
              ...centerFilter,
              ...(hasDateFilter ? { date: dateFilter } : {}),
            },
            select: {
              category: true,
              price: true,
              kitRentalCharge: true,
              packageBooking: { select: { extraCharge: true } },
              refunds: { select: { amount: true, status: true } },
            },
          });
          const byCategory = new Map<string, number>();
          for (const b of bookings) {
            const cat = b.category as string;
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
            byCategory.set(cat, (byCategory.get(cat) || 0) + net);
          }
          return {
            axis: 'category' as const,
            entries: Array.from(byCategory.entries()).map(([category, price]) => ({
              key: category,
              category,
              _sum: { price },
            })),
          };
        } catch {
          return { axis: 'machine' as const, entries: [] };
        }
      })(),
      // Self-operated bookings
      prisma.booking.count({
        where: {
          ...centerFilter,
          status: { not: 'CANCELLED' },
          operationMode: 'SELF_OPERATE',
          ...(hasDateFilter ? { date: dateFilter } : {}),
        },
      }).catch(() => 0),
      // Unassigned bookings (WITH_OPERATOR but no operator assigned)
      prisma.booking.count({
        where: {
          ...centerFilter,
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
          ...centerFilter,
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
      // Backward-compat: old clients still read `machineRevenue` as the
      // legacy `[{machineId,_sum}]` shape. Send that view when the
      // breakdown's axis is machine; send an empty array for category
      // axis (the new clients use `revenueBreakdown`).
      machineRevenue: revenueBreakdown.axis === 'machine' ? revenueBreakdown.entries : [],
      revenueBreakdown,
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
