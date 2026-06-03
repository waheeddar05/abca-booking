import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/adminAuth';
import { getAuthenticatedUser } from '@/lib/auth';
import { resolveCurrentCenter } from '@/lib/centers';
import { getISTTodayUTC, getISTLastMonthRange, dateStringToUTC } from '@/lib/time';

// Epoch millis for a nullable groupBy `_max.date`. Used to break ties when two
// staff have the same session count so the most recent booking ranks higher.
function latestTime(d: Date | null): number {
  return d ? new Date(d).getTime() : 0;
}

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

    // Build date filter for queries.
    // Parse defensively: an invalid/malformed date param must never reach
    // Prisma (an `Invalid Date` makes every query throw → 500). We simply
    // ignore anything we can't parse, and we swap an inverted range so a
    // valid selection where the user picked the dates out of order still
    // returns data instead of an empty/erroring result.
    const parseDateParam = (value: string | null): Date | null => {
      if (!value) return null;
      const d = dateStringToUTC(value);
      return Number.isNaN(d.getTime()) ? null : d;
    };
    let fromDate = parseDateParam(fromParam);
    let toDate = parseDateParam(toParam);
    if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
      [fromDate, toDate] = [toDate, fromDate];
    }
    const dateFilter: { gte?: Date; lte?: Date } = {};
    if (fromDate) dateFilter.gte = fromDate;
    if (toDate) dateFilter.lte = toDate;
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
        _max: { date: true },
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
        // Sort highest session count first so top performers surface at the top;
        // most recent booking date breaks ties (within the active date range).
        return [...results]
          .sort((a, b) => b._count._all - a._count._all || latestTime(b._max.date) - latestTime(a._max.date))
          .map(r => ({
            id: r.operatorId!,
            name: nameMap.get(r.operatorId!) || 'Unnamed',
            sessions: r._count._all,
          }));
      }).catch(() => []),
      prisma.booking.groupBy({
        by: ['assignedStaffId'],
        _count: { _all: true },
        _max: { date: true },
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
        // Sort highest session count first; most recent booking date breaks ties.
        return [...results]
          .sort((a, b) => b._count._all - a._count._all || latestTime(b._max.date) - latestTime(a._max.date))
          .map(r => ({
            id: r.assignedStaffId!,
            name: nameMap.get(r.assignedStaffId!) || 'Unnamed',
            sessions: r._count._all,
          }));
      }).catch(() => []),
      prisma.booking.groupBy({
        by: ['assignedCoachId'],
        _count: { _all: true },
        _max: { date: true },
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
        // Sort highest session count first; most recent booking date breaks ties.
        return [...results]
          .sort((a, b) => b._count._all - a._count._all || latestTime(b._max.date) - latestTime(a._max.date))
          .map(r => ({
            id: r.assignedCoachId!,
            name: nameMap.get(r.assignedCoachId!) || 'Unnamed',
            sessions: r._count._all,
          }));
      }).catch(() => []),
      // Revenue by Machine. Only for MACHINE category.
      // The label must always be the exact machine name shown in
      // My Center → Resources, i.e. the Machine instance's `name`. We never
      // fall back to the MachineType catalog name (e.g. "Leverage Tennis"),
      // which is the design/category name and is inconsistent with Resources.
      (async () => {
        try {
          // Resolve legacy enum bookings to the center's actual machine names.
          const centerMachines = await prisma.machine.findMany({
            where: { ...centerFilter },
            select: { name: true, legacyMachineId: true },
          });
          const legacyNameMap = new Map<string, string>();
          for (const m of centerMachines) {
            if (m.legacyMachineId) legacyNameMap.set(m.legacyMachineId, m.name);
          }

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
              assignedMachine: { select: { name: true, machineType: { select: { name: true } } } }, // New
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
            if (b.assignedMachine?.name) {
              // Resources display name (authoritative).
              typeName = b.assignedMachine.name;
            } else if (b.machineId) {
              // Legacy enum booking — map to this center's machine name,
              // falling back to a sensible label per enum value.
              typeName =
                legacyNameMap.get(b.machineId) ||
                (b.machineId === 'YANTRA' ? 'Yantra'
                  : b.machineId === 'LEVERAGE_OUTDOOR' ? 'Leverage Outdoor'
                  : b.machineId === 'LEVERAGE_INDOOR' ? 'Leverage Indoor'
                  : b.machineId === 'GRAVITY' ? 'Gravity'
                  : 'Other');
            } else if (b.assignedMachine?.machineType?.name) {
              // Last resort only — should rarely happen.
              typeName = b.assignedMachine.machineType.name;
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
      // Booking Distribution Table Data (Category vs Today vs Upcoming).
      // "Today" and "Upcoming" are live operational snapshots that mean exactly
      // what their column headers say — today's bookings and future bookings.
      // They are intentionally NOT scoped by the dashboard date-range filter
      // (the range drives the revenue/aggregate sections). The previous code
      // spread `{ date: dateFilter }` over the explicit `date` key, silently
      // overwriting it and making both columns identical whenever any range was
      // active — which is always, since the UI auto-applies a default range.
      (async () => {
        try {
          const categories = ['MACHINE', 'SIDEARM', 'NET', 'FULL_COURT'] as const;
          const results = await Promise.all(categories.map(async (cat) => {
            const [todayCount, upcomingCount] = await Promise.all([
              prisma.booking.count({
                where: {
                  ...centerFilter,
                  category: cat,
                  date: todayUTC,
                  status: { not: 'CANCELLED' },
                },
              }).catch(() => 0),
              prisma.booking.count({
                where: {
                  ...centerFilter,
                  category: cat,
                  date: { gt: todayUTC },
                  status: 'BOOKED',
                },
              }).catch(() => 0),
            ]);
            return { category: cat, today: todayCount, upcoming: upcomingCount };
          }));
          return results;
        } catch {
          return [];
        }
      })(),
      prisma.booking.count({
        where: {
          ...centerFilter,
          status: { not: 'CANCELLED' },
          ...(hasDateFilter ? { date: dateFilter } : {}),
        },
      }).catch(() => 0),
      // "Active admins" = ADMIN users at this center (or globally for super admin platform view).
      (centerId
        ? prisma.centerMembership.count({ where: { centerId, role: 'ADMIN', isActive: true } })
        : prisma.user.count({ where: { role: 'ADMIN' } })).catch(() => 0),
      prisma.booking.count({
        where: { ...centerFilter, date: todayUTC, status: { not: 'CANCELLED' } },
      }).catch(() => 0),
      prisma.booking.count({
        where: { ...centerFilter, date: { gt: todayUTC }, status: 'BOOKED' },
      }).catch(() => 0),
      prisma.booking.count({
        where: {
          ...centerFilter,
          date: {
            gte: lastMonthRange.start,
            lte: lastMonthRange.end,
          },
          status: { not: 'CANCELLED' },
        },
      }).catch(() => 0),
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
      // Package revenue — total package SALES within the selected date range.
      // Revenue is recognised at purchase, so we scope by the package's purchase
      // timestamp (UserPackage.createdAt) using the dashboard From/To filter and
      // net out refunds. Cancelled packages are excluded. Every package category
      // (Bowling Machine, Cricket Net, Sidearm, Coaching, Court, …) is included
      // because we don't filter by category. The createdAt bounds are shifted by
      // the IST offset so a calendar day picked in the UI maps to the matching
      // IST day (createdAt is a real timestamp, unlike the @db.Date booking col).
      (async () => {
        try {
          const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
          let createdFilter: { gte?: Date; lt?: Date } | undefined;
          if (fromDate || toDate) {
            createdFilter = {};
            if (fromDate) createdFilter.gte = new Date(fromDate.getTime() - IST_OFFSET_MS);
            // toDate is UTC midnight of the end day — extend to the end of that IST day.
            if (toDate) createdFilter.lt = new Date(toDate.getTime() + 24 * 60 * 60 * 1000 - IST_OFFSET_MS);
          }
          const ups = await prisma.userPackage.findMany({
            where: {
              ...(centerId ? { package: { centerId } } : {}),
              status: { not: 'CANCELLED' },
              ...(createdFilter ? { createdAt: createdFilter } : {}),
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
