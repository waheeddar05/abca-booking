import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/adminAuth';
import { getAuthenticatedUser } from '@/lib/auth';
import { resolveCurrentCenter } from '@/lib/centers';
import { getISTTodayUTC, getISTLastMonthRange, dateStringToUTC } from '@/lib/time';
import { getBookingPaymentSplits, splitAmountNet, EMPTY_SPLIT } from '@/lib/booking-payment';

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
      bookingDistribution,
      totalBookings,
      activeAdmins,
      todayBookings,
      upcomingBookings,
      lastMonthBookings,
      totalSlots,
      totalDiscountValue,
      revenue,
      selfOperatedBookings,
      unassignedBookings,
      matchPracticeSummary,
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
          // Match Practice categories included — corporate-batch seats and
          // match-simulation seats count like any other booking.
          const categories = ['MACHINE', 'SIDEARM', 'COACHING', 'NET', 'FULL_COURT', 'CORPORATE_BATCH', 'MATCH_SIMULATION'] as const;
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
      // ─── Revenue (cards + Revenue-by-Category + Revenue-by-Machine) ───
      //
      // All revenue figures are derived here from ONE shared pass so the
      // three top cards, the category chart, and the machine chart always
      // reconcile to the rupee. Revenue is what was actually COLLECTED from
      // the customer (not the list price), recognised when the money is
      // received:
      //
      //   • Booking revenue (any booking) → (online + wallet) − refunds,
      //     i.e. the funds actually collected for that booking, bucketed by
      //     the booking's category/machine. CASH and free bookings collect
      //     nothing through these rails and contribute 0. This holds for
      //     package-redemption rows too: a package session's collected amount
      //     is whatever upgrade it paid (online/wallet) — the package base was
      //     already counted at PURCHASE below, so it is not double-counted.
      //   • Package purchase             → the FULL `amountPaid` − wallet
      //     refunds, recognised on the purchase date and bucketed by the
      //     PACKAGE's category/machine — regardless of how many sessions
      //     have been used. Cancelled packages are excluded entirely.
      //
      // Therefore: Total = Booking + Package, and the sum over every
      // category bucket equals Total Revenue by construction.
      (async () => {
        const empty = {
          bookingRevenue: 0,
          packageRevenue: 0,
          totalRevenue: 0,
          revenueByCategory: [] as Array<{ key: string; _sum: { price: number } }>,
          machineTypeRevenue: [] as Array<{ name: string; revenue: number }>,
        };
        try {
          // Resolve legacy enum machine IDs → this center's actual machine
          // names (the labels shown in My Center → Resources). We never fall
          // back to the MachineType catalog name (e.g. "Leverage Tennis"),
          // which is the design/category name and inconsistent with Resources.
          const centerMachines = await prisma.machine.findMany({
            where: { ...centerFilter },
            select: { name: true, legacyMachineId: true },
          });
          const legacyNameMap = new Map<string, string>();
          for (const m of centerMachines) {
            if (m.legacyMachineId) legacyNameMap.set(m.legacyMachineId, m.name);
          }
          const machineNameFromLegacy = (machineId: string): string =>
            legacyNameMap.get(machineId) ||
            (machineId === 'YANTRA' ? 'Yantra'
              : machineId === 'LEVERAGE_OUTDOOR' ? 'iWinner (Outdoor)'
              : machineId === 'LEVERAGE_INDOOR' ? 'iWinner (Indoor)'
              : machineId === 'GRAVITY' ? 'Gravity'
              : 'Other');

          const byCategory = new Map<string, number>();
          const byMachine = new Map<string, number>();
          const addCategory = (cat: string, amount: number) =>
            byCategory.set(cat, (byCategory.get(cat) || 0) + amount);
          const addMachine = (name: string, amount: number) =>
            byMachine.set(name, (byMachine.get(name) || 0) + amount);

          // ── Bookings: direct payments + package-redemption extras ──
          const bookings = await prisma.booking.findMany({
            where: {
              ...centerFilter,
              status: { in: ['BOOKED', 'DONE'] },
              ...(hasDateFilter ? { date: dateFilter } : {}),
            },
            select: {
              id: true,
              category: true,
              price: true,
              paymentMethod: true,
              machineId: true, // Legacy enum reference
              assignedMachine: { select: { name: true, machineType: { select: { name: true } } } },
              refunds: { select: { amount: true, status: true } },
            },
          });

          // Funds actually collected per booking, derived from the captured
          // Payment record (even per-slot share of the order's online amount +
          // wallet deduction) — Booking.price drifts from the collected money,
          // so it is only a fallback for rows with no payment. Same definition
          // the CSV export and admin list use, so all three reconcile.
          const paymentSplits = await getBookingPaymentSplits(bookings);

          let bookingRevenue = 0;
          for (const b of bookings) {
            // Net of non-failed refunds. Cash/free/package-covered rows resolve
            // to 0. Identical for regular and package-redemption rows.
            const value = splitAmountNet(
              paymentSplits.get(b.id) ?? EMPTY_SPLIT,
              b.refunds,
            );
            bookingRevenue += value;
            addCategory(b.category, value);
            if (b.category === 'MACHINE') {
              let name = 'Other';
              if (b.assignedMachine?.name) name = b.assignedMachine.name;
              else if (b.machineId) name = machineNameFromLegacy(b.machineId);
              else if (b.assignedMachine?.machineType?.name) name = b.assignedMachine.machineType.name;
              addMachine(name, value);
            }
          }

          // ── Package purchases: full amount recognised on purchase date ──
          // Scope by UserPackage.createdAt with the dashboard From/To filter,
          // shifting the bounds by the IST offset so a calendar day picked in
          // the UI maps to the matching IST day (createdAt is a real timestamp,
          // unlike the @db.Date booking column).
          const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
          let createdFilter: { gte?: Date; lt?: Date } | undefined;
          if (fromDate || toDate) {
            createdFilter = {};
            if (fromDate) createdFilter.gte = new Date(fromDate.getTime() - IST_OFFSET_MS);
            if (toDate) createdFilter.lt = new Date(toDate.getTime() + 24 * 60 * 60 * 1000 - IST_OFFSET_MS);
          }
          const ups = await prisma.userPackage.findMany({
            where: {
              ...(centerId ? { package: { centerId } } : {}),
              status: { not: 'CANCELLED' },
              ...(createdFilter ? { createdAt: createdFilter } : {}),
            },
            select: {
              id: true,
              amountPaid: true,
              package: {
                select: {
                  category: true,
                  machineId: true,
                  machineRow: { select: { name: true } },
                },
              },
            },
          });

          let packageRevenue = 0;
          if (ups.length > 0) {
            const refundRows = await prisma.walletTransaction.findMany({
              where: { type: 'CREDIT_REFUND', referenceId: { in: ups.map(u => u.id) } },
              select: { referenceId: true, amount: true },
            });
            const refundById = new Map<string, number>();
            for (const r of refundRows) {
              if (!r.referenceId) continue;
              refundById.set(r.referenceId, (refundById.get(r.referenceId) || 0) + r.amount);
            }
            for (const up of ups) {
              const net = up.amountPaid - (refundById.get(up.id) || 0);
              packageRevenue += net;
              // Legacy ABCA packages have a null category — they are bowling
              // machine packages, so they fall into MACHINE.
              const cat = up.package?.category || 'MACHINE';
              addCategory(cat, net);
              if (cat === 'MACHINE') {
                let name = 'Other';
                if (up.package?.machineRow?.name) name = up.package.machineRow.name;
                else if (up.package?.machineId) name = machineNameFromLegacy(up.package.machineId);
                addMachine(name, net);
              }
            }
          }

          return {
            bookingRevenue,
            packageRevenue,
            totalRevenue: bookingRevenue + packageRevenue,
            revenueByCategory: Array.from(byCategory.entries()).map(([category, price]) => ({
              key: category,
              _sum: { price },
            })),
            machineTypeRevenue: Array.from(byMachine.entries()).map(([name, revenue]) => ({ name, revenue })),
          };
        } catch {
          return empty;
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
      // Match Practice session stats — booking counts per subcategory,
      // mirroring the operator/sidearm/coach summary cards. Each category
      // splits into "Monthly" (MONTHLY + HALF_MONTH passes) and "Regular"
      // (per-session seats — mode REGULAR for Corporate Batch, null for
      // Match Simulation). Respects the dashboard date range like the
      // other summaries.
      prisma.booking.groupBy({
        by: ['category', 'corporateBatchMode'],
        _count: { _all: true },
        where: {
          ...centerFilter,
          status: { not: 'CANCELLED' },
          category: { in: ['CORPORATE_BATCH', 'MATCH_SIMULATION'] },
          ...(hasDateFilter ? { date: dateFilter } : {}),
        },
      }).then((rows) => {
        let matchSimMonthly = 0;
        let matchSimRegular = 0;
        let corporateMonthly = 0;
        let corporateRegular = 0;
        for (const r of rows) {
          const n = r._count._all;
          const isMonthlyPass = r.corporateBatchMode === 'MONTHLY' || r.corporateBatchMode === 'HALF_MONTH';
          if (r.category === 'MATCH_SIMULATION') {
            if (isMonthlyPass) matchSimMonthly += n;
            else matchSimRegular += n; // per-session seats carry a null mode
          } else if (r.category === 'CORPORATE_BATCH') {
            if (isMonthlyPass) corporateMonthly += n;
            else corporateRegular += n; // REGULAR (per-session) rows
          }
        }
        return { matchSimMonthly, matchSimRegular, corporateMonthly, corporateRegular };
      }).catch(() => ({ matchSimMonthly: 0, matchSimRegular: 0, corporateMonthly: 0, corporateRegular: 0 })),
    ]);

    return NextResponse.json({
      totalBookings,
      activeAdmins,
      todayBookings,
      upcomingBookings,
      lastMonthBookings,
      totalSlots,
      totalRevenue: revenue.totalRevenue,
      bookingRevenue: revenue.bookingRevenue,
      packageRevenue: revenue.packageRevenue,
      totalDiscount: totalDiscountValue,
      revenueBreakdown: { axis: 'category', entries: revenue.revenueByCategory },
      machineTypeRevenue: revenue.machineTypeRevenue,
      bookingDistribution,
      selfOperatedBookings,
      unassignedBookings,
      operatorSummary,
      sidearmSummary,
      coachSummary,
      matchPracticeSummary,
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
