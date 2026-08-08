import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/adminAuth';
import { getAuthenticatedUser } from '@/lib/auth';
import { resolveCurrentCenter } from '@/lib/centers';
import { getISTTodayUTC, getISTLastMonthRange, dateStringToUTC } from '@/lib/time';
import { getBookingPaymentSplits, sumActiveRefunds, EMPTY_SPLIT } from '@/lib/booking-payment';
import {
  aggregateRevenue,
  rowRevenue,
  MANUAL_MACHINE_LABEL,
  DEFAULT_REVENUE_CATEGORY,
  type RevenueRow,
} from '@/lib/dashboard-revenue';

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

    // ─── Operator session universe ───────────────────────────────────
    //
    // Everything on the Operator Sessions card counts the SAME set of rows:
    // live bowling-machine sessions in the selected range. That set splits
    // into exactly three disjoint, exhaustive parts, so the card's numbers
    // always satisfy
    //
    //   Total = Σ(per-operator sessions) + Self-Operate + Unassigned
    //
    //   • assigned     → operatorId is set (whatever the operationMode says)
    //   • self-operate → no operator, and the row is marked SELF_OPERATE
    //   • unassigned   → no operator, but the row still expects one
    //
    // Scoping to `category: MACHINE` is what makes the identity true. Only
    // machine sessions ever carry an operator, yet `operationMode` is a
    // non-null column defaulting to WITH_OPERATOR, and the resource booking
    // engine stamps every non-machine row SELF_OPERATE — so counting across
    // all categories dumped every net / sidearm / coaching / match-practice
    // booking into the Self-Operate and Unassigned buckets.
    const operatorSessionFilter = {
      ...centerFilter,
      category: 'MACHINE' as const,
      status: { not: 'CANCELLED' as const },
      ...(hasDateFilter ? { date: dateFilter } : {}),
    };

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
      operatorSessionsTotal,
      matchPracticeSummary,
      ledgerTotals,
    ] = await Promise.all([
      // Staff sessions: total counts per operator/coach/specialist.
      prisma.booking.groupBy({
        by: ['operatorId'],
        _count: { _all: true },
        _max: { date: true },
        where: {
          ...operatorSessionFilter,
          operatorId: { not: null },
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
      // Every rupee on this dashboard comes out of ONE pass, as a list of
      // `RevenueRow`s that `aggregateRevenue` folds into the category and
      // machine buckets. That is what makes the two reconciliation rules
      // hold by construction rather than by coincidence:
      //
      //   Σ(category bars) === Total Revenue
      //   Σ(machine bars)  === the Bowling Machine category bar
      //
      // One formula for every source — Revenue = online + wallet − refunds:
      //
      //   • Booking → the booking's share of its captured Razorpay payment
      //     plus the wallet deducted for it, less its refunds; bucketed by
      //     the booking's category/machine. CASH and free bookings collect
      //     nothing through these rails and contribute 0. Package-redemption
      //     rows contribute only the upgrade they paid on top — the package
      //     base was already counted at PURCHASE below, never twice.
      //   • Package purchase → the FULL `amountPaid` − wallet refunds,
      //     recognised on the purchase date and bucketed by the PACKAGE's
      //     category/machine, regardless of how many sessions have been used.
      //
      // CANCELLED rows are INCLUDED, net of their refunds: a cancellation
      // that kept a fee kept money, and excluding the row reported that fee
      // as ₹0. A fully refunded one nets to zero on its own.
      (async () => {
        const empty = {
          bookingRevenue: 0,
          packageRevenue: 0,
          rows: [] as RevenueRow[],
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

          const rows: RevenueRow[] = [];

          // ── Bookings: direct payments + package-redemption extras ──
          // No status filter — a cancelled booking that kept a cancellation
          // fee still earned that fee, and its refunds net it out below.
          const bookings = await prisma.booking.findMany({
            where: {
              ...centerFilter,
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
            const split = paymentSplits.get(b.id) ?? EMPTY_SPLIT;
            let machineName: string | null = null;
            if (b.category === 'MACHINE') {
              if (b.assignedMachine?.name) machineName = b.assignedMachine.name;
              else if (b.machineId) machineName = machineNameFromLegacy(b.machineId);
              else if (b.assignedMachine?.machineType?.name) machineName = b.assignedMachine.machineType.name;
            }
            // Refunds are subtracted UNCLAMPED: a refund is sized from the
            // slot's (mutable) price and can exceed that slot's even share of
            // its order, so zeroing a negative row here would strand the
            // excess and over-report the order. See `splitAmountNetSigned`.
            const row: RevenueRow = {
              category: b.category,
              online: split.online,
              wallet: split.wallet,
              refunds: sumActiveRefunds(b.refunds),
              machineName,
            };
            rows.push(row);
            bookingRevenue += rowRevenue(row);
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
          // Cancelled packages are kept, exactly like cancelled bookings: the
          // cancellation refunds only the UNUSED sessions pro rata, so the
          // used portion is revenue the center earned and kept. Dropping the
          // row reported it as ₹0.
          const ups = await prisma.userPackage.findMany({
            where: {
              ...(centerId ? { package: { centerId } } : {}),
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
              // Legacy ABCA packages have a null category — they are bowling
              // machine packages, so they fall into MACHINE.
              const cat = up.package?.category || DEFAULT_REVENUE_CATEGORY;
              let machineName: string | null = null;
              if (cat === 'MACHINE') {
                if (up.package?.machineRow?.name) machineName = up.package.machineRow.name;
                else if (up.package?.machineId) machineName = machineNameFromLegacy(up.package.machineId);
              }
              // A package is bought as one amount; the online/wallet split
              // isn't tracked per purchase, so the whole `amountPaid` sits on
              // the online side of the same formula. Refunds are the wallet
              // credits raised against it.
              const row: RevenueRow = {
                category: cat,
                online: up.amountPaid,
                wallet: 0,
                refunds: refundById.get(up.id) || 0,
                machineName,
              };
              rows.push(row);
              packageRevenue += rowRevenue(row);
            }
          }

          return { bookingRevenue, packageRevenue, rows };
        } catch {
          return empty;
        }
      })(),
      // Self-operated: machine sessions the player ran themselves. Keyed on
      // "no operator AND marked self-operate" rather than the mode alone, so
      // this and `unassignedBookings` can never overlap or leave a gap.
      prisma.booking.count({
        where: {
          ...operatorSessionFilter,
          operatorId: null,
          operationMode: 'SELF_OPERATE',
        },
      }).catch(() => 0),
      // Unassigned: machine sessions that still expect an operator but have
      // none — the queue an admin needs to work through on Admin → Bookings.
      prisma.booking.count({
        where: {
          ...operatorSessionFilter,
          operatorId: null,
          operationMode: 'WITH_OPERATOR',
        },
      }).catch(() => 0),
      // The whole universe the three buckets partition.
      prisma.booking.count({ where: operatorSessionFilter }).catch(() => 0),
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
      // ─── Ledger: hand-entered revenue + expenses (Admin → Ledger) ───
      //
      // Manual revenue is real money in, so it joins Total Revenue and
      // lands in the SAME category buckets as system revenue — a cash
      // sidearm session recorded by hand belongs on the Sidearm bar next
      // to the ones the booking engine created. That is why the ledger's
      // revenue categories mirror `BookingCategory` exactly (plus OTHER
      // for income with no service behind it, which gets its own bar).
      //
      // Expenses are money OUT — reported as a separate card and
      // deliberately NOT netted off revenue, so the revenue figures stay
      // comparable with the booking/package numbers above.
      //
      // Scoped by `entryDate` (when the money changed hands), matching
      // how bookings are scoped by their session date and packages by
      // their purchase date: each recognises revenue on its own event.
      prisma.ledgerEntry.groupBy({
        by: ['kind', 'revenueCategory'],
        _sum: { amount: true },
        where: {
          ...centerFilter,
          ...(hasDateFilter ? { entryDate: dateFilter } : {}),
        },
      }).then((grouped) => {
        let manualRevenue = 0;
        let manualExpenses = 0;
        const rows: RevenueRow[] = [];
        for (const r of grouped) {
          const amount = r._sum.amount || 0;
          if (r.kind === 'REVENUE') {
            manualRevenue += amount;
            // Null category shouldn't happen (the schema requires one on
            // revenue rows), but bucket it as OTHER rather than dropping
            // it — the chart must always sum to Total Revenue.
            rows.push({
              category: r.revenueCategory ?? 'OTHER',
              online: amount,
              wallet: 0,
              refunds: 0,
              // A manual entry names a category but never a machine, and the
              // machine bars still have to sum to the Bowling Machine bar —
              // so it gets its own clearly-labelled column rather than being
              // dropped or smuggled into a real machine's total.
              machineName: MANUAL_MACHINE_LABEL,
            });
          } else {
            manualExpenses += amount;
          }
        }
        return { manualRevenue, manualExpenses, rows };
      }).catch(() => ({
        manualRevenue: 0,
        manualExpenses: 0,
        rows: [] as RevenueRow[],
      })),
    ]);

    // One fold over every money row — bookings, package purchases and
    // hand-entered Ledger revenue alike — so each bar is the whole story for
    // that service (a cash sidearm session recorded by hand sits on the
    // Sidearm bar next to the booked ones) and the reconciliation rules hold
    // by construction rather than by coincidence:
    //
    //   Σ(category bars) === Total Revenue === Bookings + Packages + Manual
    //   Σ(machine bars)  === the Bowling Machine category bar
    //
    // The machine chart is topped up the same way the category chart is: a
    // manual MACHINE entry names no machine, so it lands on its own
    // "Manual Entry" column instead of leaving the bars short of the bar
    // they are meant to explain.
    const aggregate = aggregateRevenue([...revenue.rows, ...ledgerTotals.rows]);

    return NextResponse.json({
      totalBookings,
      activeAdmins,
      todayBookings,
      upcomingBookings,
      lastMonthBookings,
      totalSlots,
      // Total Revenue = booking + package + manual (ledger) revenue, read
      // straight off the category buckets so the chart can never disagree
      // with the card above it.
      totalRevenue: aggregate.totalRevenue,
      bookingRevenue: revenue.bookingRevenue,
      packageRevenue: revenue.packageRevenue,
      manualRevenue: ledgerTotals.manualRevenue,
      manualExpenses: ledgerTotals.manualExpenses,
      totalDiscount: totalDiscountValue,
      revenueBreakdown: {
        axis: 'category',
        entries: aggregate.byCategory.map(b => ({ key: b.key, _sum: { price: b.amount } })),
      },
      machineTypeRevenue: aggregate.byMachine.map(b => ({ name: b.key, revenue: b.amount })),
      bookingDistribution,
      selfOperatedBookings,
      unassignedBookings,
      operatorSessionsTotal,
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
