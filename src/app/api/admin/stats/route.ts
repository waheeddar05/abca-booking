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
      operatorSummary,
      sidearmSummary,
      coachSummary,
      machineTypeRevenue,
      bookingDistribution,
      totalBookings,
      activeAdmins,
      todayBookings,
      upcomingBookings,
      lastMonthBookings,
      totalSlots,
      bookingRevenueValue,
      totalDiscountValue,
      packageRevenueValue,
      revenueBreakdownEntries,
      selfOperatedBookings,
      unassignedBookings,
    ] = await Promise.all([
      // Staff sessions: total counts per operator/coach/specialist.
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
          name: nameMap.get(r.operatorId!) || 'Unnamed',
          sessions: r._count._all,
        }));
      }).catch(() => []),
      prisma.booking.groupBy({
        by: ['assignedStaffId'],
        _count: { _all: true },
        where: {
          ...centerFilter,
          status: { not: 'CANCELLED' },
          assignedStaffId: { not: null },
          ...(hasDateFilter ? { date: dateFilter } : {}),
        },
      }).then(async (results) => {
        if (results.length === 0) return [];
        const staffIds = results.map(r => r.assignedStaffId).filter(Boolean) as string[];
        const staff = await prisma.user.findMany({
          where: { id: { in: staffIds } },
          select: { id: true, name: true },
        });
        const nameMap = new Map(staff.map(o => [o.id, o.name]));
        return results.map(r => ({
          id: r.assignedStaffId!,
          name: nameMap.get(r.assignedStaffId!) || 'Unnamed',
          sessions: r._count._all,
        }));
      }).catch(() => []),
      prisma.booking.groupBy({
        by: ['assignedCoachId'],
        _count: { _all: true },
        where: {
          ...centerFilter,
          status: { not: 'CANCELLED' },
          assignedCoachId: { not: null },
          ...(hasDateFilter ? { date: dateFilter } : {}),
        },
      }).then(async (results) => {
        if (results.length === 0) return [];
        const coachIds = results.map(r => r.assignedCoachId).filter(Boolean) as string[];
        const coaches = await prisma.user.findMany({
          where: { id: { in: coachIds } },
          select: { id: true, name: true },
        });
        const nameMap = new Map(coaches.map(o => [o.id, o.name]));
        return results.map(r => ({
          id: r.assignedCoachId!,
          name: nameMap.get(r.assignedCoachId!) || 'Unnamed',
          sessions: r._count._all,
        }));
      }).catch(() => []),
      // Revenue by Machine Type (Yantra vs Master 200). Only for MACHINE category.
      (async () => {
        try {
          const bookings = await prisma.booking.findMany({
            where: {
              ...centerFilter,
              category: 'MACHINE',
              status: { in: ['BOOKED', 'DONE'] },
              ...(hasDateFilter ? { date: dateFilter } : {}),
            },
            select: {
              price: true,
              kitRentalCharge: true,
              machineId: true, // Legacy
              assignedMachine: { select: { machineType: { select: { name: true } } } }, // New
              packageBooking: {
                select: {
                  sessionsUsed: true,
                  extraCharge: true,
                  userPackage: { select: { amountPaid: true, totalSessions: true } },
                },
              },
              refunds: { select: { amount: true, status: true } },
            },
          });

          const revenueByType = new Map<string, number>();
          for (const b of bookings) {
            let typeName = 'Other';
            if (b.assignedMachine?.machineType?.name) {
              typeName = b.assignedMachine.machineType.name;
            } else if (b.machineId) {
              // Legacy fallback
              if (b.machineId === 'YANTRA') typeName = 'Yantra';
              else if (b.machineId === 'LEVERAGE_OUTDOOR') typeName = 'Master 200';
              else if (b.machineId === 'LEVERAGE_INDOOR') typeName = 'Leverage Indoor';
              else if (b.machineId === 'GRAVITY') typeName = 'Gravity';
            }

            let net = 0;
            if (b.packageBooking) {
              const pb = b.packageBooking;
              const total = pb.userPackage.totalSessions || 0;
              const perSession = total > 0 ? pb.userPackage.amountPaid / total : 0;
              net = perSession * (pb.sessionsUsed || 1) + (pb.extraCharge || 0) + (b.kitRentalCharge || 0);
            } else {
              net = b.price || 0;
              for (const r of b.refunds) {
                if (r.status !== 'FAILED') net -= r.amount;
              }
            }
            revenueByType.set(typeName, (revenueByType.get(typeName) || 0) + net);
          }
          return Array.from(revenueByType.entries()).map(([name, revenue]) => ({ name, revenue }));
        } catch {
          return [];
        }
      })(),
      // Booking Distribution Table Data (Category vs Today vs Upcoming)
      // Note: "Today" and "Upcoming" are fixed points in time, 
      // but the issue says "Counts must dynamically update based on selected date range."
      // This means we should filter by date range AND the definition of Today/Upcoming.
      (async () => {
        const categories = ['MACHINE', 'SIDEARM', 'NET', 'FULL_COURT'];
        const results = await Promise.all(categories.map(async (cat) => {
          const todayCount = await prisma.booking.count({
            where: { 
              ...centerFilter, 
              category: cat as any, 
              date: todayUTC, 
              status: { not: 'CANCELLED' },
              ...(hasDateFilter ? { date: dateFilter } : {}),
            },
          });
          const upcomingCount = await prisma.booking.count({
            where: { 
              ...centerFilter, 
              category: cat as any, 
              date: { gt: todayUTC }, 
              status: 'BOOKED',
              ...(hasDateFilter ? { date: dateFilter } : {}),
            },
          });
          return { category: cat, today: todayCount, upcoming: upcomingCount };
        }));
        return results;
      })(),
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
      // Booking revenue — net of refunds
      (async () => {
        try {
          const bookings = await prisma.booking.findMany({
            where: {
              ...centerFilter,
              status: { in: ['BOOKED', 'DONE'] },
              ...(hasDateFilter ? { date: dateFilter } : {}),
            },
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
      // Package revenue
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
      // Revenue breakdown
      (async () => {
        try {
          const packageSelect = {
            sessionsUsed: true,
            extraCharge: true,
            userPackage: { select: { amountPaid: true, totalSessions: true } },
          } as const;

          const packageSessionRevenue = (
            pb: { sessionsUsed: number; extraCharge: number; userPackage: { amountPaid: number; totalSessions: number } } | null,
          ) => {
            if (!pb) return 0;
            const total = pb.userPackage.totalSessions || 0;
            const perSession = total > 0 ? pb.userPackage.amountPaid / total : 0;
            return perSession * (pb.sessionsUsed || 1) + (pb.extraCharge || 0);
          };

          const bookings = await prisma.booking.findMany({
            where: {
              ...centerFilter,
              status: { in: ['BOOKED', 'DONE'] },
              ...(hasDateFilter ? { date: dateFilter } : {}),
            },
            select: {
              category: true,
              price: true,
              kitRentalCharge: true,
              packageBooking: { select: packageSelect },
              refunds: { select: { amount: true, status: true } },
            },
          });
          const byCategory = new Map<string, number>();
          for (const b of bookings) {
            const cat = b.category as string;
            const isPkg = !!b.packageBooking;
            let net = 0;
            if (isPkg) {
              net += packageSessionRevenue(b.packageBooking) + (b.kitRentalCharge || 0);
            } else {
              net += b.price || 0;
              for (const r of b.refunds) {
                if (r.status !== 'FAILED') net -= r.amount;
              }
            }
            byCategory.set(cat, (byCategory.get(cat) || 0) + net);
          }
          return Array.from(byCategory.entries()).map(([category, price]) => {
            const count = bookings.filter(b => b.category === category).length;
            return {
              key: category,
              _sum: { price, count },
            };
          });
        } catch {
          return [];
        }
      })(),
      prisma.booking.count({
        where: {
          ...centerFilter,
          status: { not: 'CANCELLED' },
          operationMode: 'SELF_OPERATE',
          ...(hasDateFilter ? { date: dateFilter } : {}),
        },
      }).catch(() => 0),
      prisma.booking.count({
        where: {
          ...centerFilter,
          status: { not: 'CANCELLED' },
          operationMode: 'WITH_OPERATOR',
          operatorId: null,
          ...(hasDateFilter ? { date: dateFilter } : {}),
        },
      }).catch(() => 0),
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
      revenueBreakdown: { axis: 'category', entries: revenueBreakdownEntries },
      machineTypeRevenue,
      bookingDistribution,
      selfOperatedBookings,
      unassignedBookings,
      operatorSummary,
      sidearmSummary,
      coachSummary,
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
