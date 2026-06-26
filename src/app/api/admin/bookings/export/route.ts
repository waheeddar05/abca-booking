import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/adminAuth';
import { getAuthenticatedUser } from '@/lib/auth';
import { resolveCurrentCenter } from '@/lib/centers';
import { getISTTodayUTC, getISTLastMonthRange, dateStringToUTC, formatIST } from '@/lib/time';

const SAFE_BOOKING_SELECT = {
  id: true,
  date: true,
  startTime: true,
  endTime: true,
  status: true,
  ballType: true,
  playerName: true,
  createdAt: true,
  createdBy: true,
  updatedAt: true,
  price: true,
  paymentMethod: true,
  paymentStatus: true,
  machineId: true,
  pitchType: true,
  operationMode: true,
  cancelledBy: true,
  discountAmount: true,
  kitRental: true,
  kitRentalCharge: true,
  // Resource-based (Toplay) fields. Null on ABCA rows; populated on
  // category-based bookings so the CSV captures the actual machine /
  // coach / staff that ran the session.
  category: true,
  assignedMachine: { select: { name: true, shortName: true } },
  assignedCoach: { select: { name: true } },
  assignedStaff: { select: { name: true } },
  user: { select: { email: true, mobileNumber: true } },
} as const;

export async function GET(req: NextRequest) {
  try {
    const session = await requireAdmin(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const category = searchParams.get('category');
    const date = searchParams.get('date');
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const status = searchParams.get('status');
    const customer = searchParams.get('customer');
    const userId = searchParams.get('userId');
    const categoryFilter = searchParams.get('categoryFilter');
    const allCenters = searchParams.get('allCenters') === 'true';

    const adminUser = await getAuthenticatedUser(req);
    const center = adminUser ? await resolveCurrentCenter(req, adminUser) : null;

    const where: any = {};
    if (!allCenters && center) {
      where.centerId = center.id;
    } else if (!allCenters && !center) {
      return NextResponse.json({ error: 'No center selected' }, { status: 400 });
    } else if (allCenters && !adminUser?.isSuperAdmin) {
      return NextResponse.json({ error: 'allCenters requires super admin' }, { status: 403 });
    }
    const todayUTC = getISTTodayUTC();
    const now = new Date();

    if (category === 'today') {
      where.date = todayUTC;
    } else if (category === 'upcoming') {
      where.date = { gt: todayUTC };
      where.status = 'BOOKED';
    } else if (category === 'previous') {
      where.date = { lt: todayUTC };
    } else if (category === 'lastMonth') {
      const lastMonthRange = getISTLastMonthRange();
      where.date = {
        gte: lastMonthRange.start,
        lte: lastMonthRange.end,
      };
    }

    if (date) {
      where.date = dateStringToUTC(date);
    } else if (from && to) {
      where.date = {
        gte: dateStringToUTC(from),
        lte: dateStringToUTC(to),
      };
    }

    // Status filter mirrors the admin bookings list: IN_PROGRESS / BOOKED
    // (Upcoming) / DONE (Completed) are *derived* from BOOKED + the current
    // time, not stored verbatim. The export previously did a naive
    // `where.status = status`, so a CSV pulled while the list was filtered to
    // "Completed" silently excluded BOOKED-but-already-ended sessions — the
    // file disagreed with the screen. Match the list logic exactly.
    if (status === 'IN_PROGRESS') {
      where.status = 'BOOKED';
      where.startTime = { lte: now };
      where.endTime = { gt: now };
    } else if (status === 'BOOKED') {
      where.status = 'BOOKED';
      where.startTime = { gt: now };
    } else if (status === 'DONE') {
      where.AND = [
        ...(where.AND || []),
        {
          OR: [
            { status: 'DONE' },
            { status: 'BOOKED', endTime: { lte: now } },
          ],
        },
      ];
    } else if (status) {
      where.status = status;
    }

    // Exact-customer filter — when the admin picked a specific customer
    // from the Customer autocomplete, the list scopes to that user's id.
    // Mirror it here so the CSV contains only that customer's rows.
    if (userId) {
      where.userId = userId;
    } else if (customer) {
      // Free-text fallback (admin typed a name without selecting) — same
      // name/email substring match the list uses.
      where.OR = [
        { playerName: { contains: customer, mode: 'insensitive' } },
        { user: { name: { contains: customer, mode: 'insensitive' } } },
        { user: { email: { contains: customer, mode: 'insensitive' } } },
      ];
    }

    // Booking-category filter — same handling as the list. Every Booking
    // row carries a non-null `category` (schema default 'MACHINE'; ABCA's
    // legacy rows were backfilled to MACHINE), so an exact equality match
    // is correct for every category, MACHINE included. The previous
    // `OR: [{category:'MACHINE'},{category:null}]` form collapsed into a
    // match-everything clause on the non-nullable enum (a `null` filter is
    // not a valid IS NULL predicate), so a Bowling Machine export captured
    // every category — the CSV equivalent of the list-view leak.
    if (categoryFilter) {
      const validCategories = new Set(['MACHINE', 'SIDEARM', 'COACHING', 'NET', 'FULL_COURT', 'CORPORATE_BATCH']);
      if (validCategories.has(categoryFilter)) {
        where.category = categoryFilter;
      }
    }

    // Try full query; fall back to safe select if new columns don't exist yet
    let bookings: any[];
    try {
      bookings = await prisma.booking.findMany({
        where,
        include: {
          user: { select: { email: true, mobileNumber: true } },
          // Resource-based axes — joined here too so the CSV row can
          // surface category / assigned machine / coach / staff for
          // Toplay rows. Null fields are simply blank on ABCA rows.
          assignedMachine: { select: { name: true, shortName: true } },
          assignedCoach: { select: { name: true } },
          assignedStaff: { select: { name: true } },
          packageBooking: {
            include: {
              userPackage: {
                include: { package: { select: { name: true } } }
              }
            }
          },
          refunds: { select: { amount: true, method: true, status: true } },
        },
        orderBy: [{ date: 'desc' }, { startTime: 'asc' }],
      });
    } catch {
      bookings = await prisma.booking.findMany({
        where,
        select: SAFE_BOOKING_SELECT,
        orderBy: [{ date: 'desc' }, { startTime: 'asc' }],
      });
    }

    // Build CSV
    const isPackage = (b: any) => !!b.packageBooking;

    // Load all payments linked to these bookings so we can compute the
    // wallet/online split per booking. A single Payment can cover multiple
    // bookings (multi-slot order) — we allocate the wallet + online
    // portions proportionally to each booking's price.
    const bookingIds = bookings.filter(b => !isPackage(b)).map(b => b.id);
    const payments = bookingIds.length > 0
      ? await prisma.payment.findMany({
          where: {
            status: 'CAPTURED',
            bookingIds: { hasSome: bookingIds },
          },
          select: { id: true, amount: true, metadata: true, bookingIds: true },
        })
      : [];

    const priceByBookingId = new Map<string, number>(
      bookings.map(b => [b.id, b.price ?? 0]),
    );
    const paymentByBookingId = new Map<string, typeof payments[number]>();
    for (const p of payments) {
      for (const bId of p.bookingIds) paymentByBookingId.set(bId, p);
    }

    const computeSplit = (b: any): { wallet: number; online: number } => {
      if (isPackage(b)) return { wallet: 0, online: 0 };
      // Pure wallet booking — booking row records this via paymentMethod.
      if (b.paymentMethod === 'WALLET') {
        return { wallet: b.price || 0, online: 0 };
      }
      if (b.paymentMethod === 'CASH') {
        return { wallet: 0, online: 0 };
      }
      const payment = paymentByBookingId.get(b.id);
      if (!payment) {
        // No captured payment — fall back to recorded method.
        if (b.paymentMethod === 'ONLINE') {
          return { wallet: 0, online: b.price || 0 };
        }
        return { wallet: 0, online: 0 };
      }
      const orderTotal = payment.bookingIds.reduce(
        (sum, bId) => sum + (priceByBookingId.get(bId) ?? 0),
        0,
      );
      const meta = (payment.metadata as Record<string, unknown> | null) ?? null;
      const walletPortion = typeof meta?.walletDeduction === 'number' ? meta.walletDeduction : 0;
      const onlinePortion = payment.amount;
      const myPrice = b.price ?? 0;
      if (orderTotal > 0) {
        return {
          wallet: Math.round((myPrice / orderTotal) * walletPortion),
          online: Math.round((myPrice / orderTotal) * onlinePortion),
        };
      }
      return { wallet: walletPortion, online: onlinePortion };
    };

    // Check if there are any package bookings to decide whether to show Extra Amount column
    const hasPackageBookings = bookings.some((b: any) => !!b.packageBooking);

    // Map raw BookingCategory enum to human-readable labels. ABCA legacy
    // rows have null category but are effectively bowling-machine
    // sessions (schema defaults to MACHINE), so the fallback is "Bowling
    // Machine".
    const CATEGORY_LABELS: Record<string, string> = {
      MACHINE: 'Bowling Machine',
      SIDEARM: 'Sidearm',
      NET: 'Cricket Nets',
      FULL_COURT: 'Full Indoor Court',
      COACHING: 'Personal Coaching',
      CORPORATE_BATCH: 'Corporate Batch',
    };
    const categoryLabel = (raw: string | null | undefined): string =>
      (raw && CATEGORY_LABELS[raw]) || 'Bowling Machine';

    // Ball type / operation mode only apply to bowling-machine sessions.
    // For sidearm / nets / coaching / full-court / corporate-batch the
    // cell reads "Not Applicable" (mirrors the admin bookings page
    // which gates operation mode on `!category || category === 'MACHINE'`).
    const isMachineBooking = (b: { category?: string | null }): boolean =>
      !b.category || b.category === 'MACHINE';

    const headers = [
      'Booking ID',
      'Date',
      'Created At',
      'Start Time',
      'End Time',
      'Player Name',
      'User Email',
      'User Mobile',
      'Booking Type',
      'Package Name',
      'Package ID',
      'Ball Type',
      'Pitch Type',
      'Machine',
      // Resource-based axes (Toplay). Empty on ABCA rows.
      'Category',
      'Coach',
      'Staff',
      'Operation Mode',
      'Status',
      'Amount',
      // Split of the booking amount across the two funding sources.
      // For a mixed payment (some wallet + some Razorpay), the wallet
      // portion comes from Payment.metadata.walletDeduction and the
      // online portion is Payment.amount; both are pro-rated to this
      // booking's share when the order covered multiple slots.
      // Pure WALLET bookings → full amount under Wallet, 0 Online.
      // CASH/PACKAGE bookings → 0 / 0.
      'Wallet Amount',
      'Online Amount',
      'Payment Method',
      ...(hasPackageBookings ? ['Extra Amount'] : []),
      'Created By',
      'Cancelled By',
      'Cancelled At',
      'Payment Status',
      'Kit Rental',
      'Kit Rental Charge',
      'Refund Status',
      'Refund Amount',
      'Refund Method',
    ];

    const rows = bookings.map((b: any) => {
      const pkg = isPackage(b);

      // Compute refund columns
      const refunds: any[] = b.refunds || [];
      let refundStatus = 'NA';
      let refundAmount = 'NA';
      let refundMethodCol = 'NA';

      if (pkg) {
        // Package bookings: refund fields stay NA
      } else if (refunds.length > 0) {
        const activeRefunds = refunds.filter((r: any) => r.status !== 'FAILED');
        const totalRefunded = activeRefunds.reduce((sum: number, r: any) => sum + r.amount, 0);
        const hasInitiated = activeRefunds.some((r: any) => r.status === 'INITIATED');

        if (totalRefunded > 0) {
          refundAmount = totalRefunded.toString();
          if (hasInitiated && totalRefunded < (b.price || Infinity)) {
            refundStatus = 'Refund Initiated';
          } else if (totalRefunded >= (b.price || 0) && b.price) {
            refundStatus = 'Full Refund';
          } else {
            refundStatus = 'Partial Refund';
          }
          const methods = new Set(activeRefunds.map((r: any) => r.method));
          if (methods.size > 1) refundMethodCol = 'Mixed';
          else if (methods.has('RAZORPAY')) refundMethodCol = 'Razorpay';
          else refundMethodCol = 'Wallet';
        }
      }

      // Single machine label that works for both models: legacy enum on
      // ABCA, resource Machine row on Toplay. Whichever is non-null.
      const machineLabel = b.machineId
        || b.assignedMachine?.shortName
        || b.assignedMachine?.name
        || 'Not Applicable';

      // Wallet / online split for this booking. computeSplit() returns
      // {0, 0} for package + cash rows; for mixed wallet+Razorpay
      // payments it pro-rates the funding across all bookings in the
      // same order so the per-row numbers always sum back to the
      // captured payment.
      const split = computeSplit(b);
      const machineRow = isMachineBooking(b);
      // Payment Method display:
      //   pkg rows           → 'NA' (unchanged)
      //   wallet > 0 && online > 0 → 'Wallet + Online'
      //   wallet > 0 only    → 'Wallet'
      //   online > 0 only    → 'Online'
      //   else               → raw paymentMethod (covers CASH / unknown)
      let paymentMethodCol: string;
      if (pkg) {
        paymentMethodCol = 'NA';
      } else if (split.wallet > 0 && split.online > 0) {
        paymentMethodCol = 'Wallet + Online';
      } else if (split.wallet > 0) {
        paymentMethodCol = 'Wallet';
      } else if (split.online > 0) {
        paymentMethodCol = 'Online';
      } else {
        paymentMethodCol = b.paymentMethod || '';
      }
      return [
        b.id,
        formatIST(b.date, 'yyyy-MM-dd'),
        formatIST(b.createdAt, 'yyyy-MM-dd HH:mm:ss'),
        formatIST(b.startTime, 'HH:mm'),
        formatIST(b.endTime, 'HH:mm'),
        b.playerName || '',
        b.user?.email || 'Not Applicable',
        b.user?.mobileNumber || 'Not Applicable',
        pkg ? 'Package' : 'Regular',
        pkg ? (b.packageBooking?.userPackage?.package?.name || '') : 'Not Applicable',
        pkg ? (b.packageBooking?.userPackageId || '') : 'Not Applicable',
        machineRow ? b.ballType : 'Not Applicable',
        b.pitchType || 'Not Applicable',
        machineLabel,
        // Resource-based columns: category (human label), coach, staff.
        // Legacy ABCA rows have null category but represent bowling
        // machine sessions, so the label falls back to "Bowling Machine".
        categoryLabel(b.category),
        b.assignedCoach?.name || 'Not Applicable',
        b.assignedStaff?.name || 'Not Applicable',
        machineRow ? (b.operationMode || '') : 'Not Applicable',
        b.status,
        pkg ? ((b.packageBooking?.extraCharge || 0) + (b.kitRentalCharge || 0)).toString() : (b.price?.toString() || ''),
        // Wallet / online amounts paired with the same row as the
        // total so a quick sum check is obvious in Excel.
        split.wallet.toString(),
        split.online.toString(),
        paymentMethodCol,
        ...(hasPackageBookings ? [pkg ? (b.packageBooking?.extraCharge ? b.packageBooking.extraCharge.toString() : '0') : '0'] : []),
        b.createdBy || '',
        b.cancelledBy || '',
        b.status === 'CANCELLED' && b.updatedAt ? formatIST(b.updatedAt, 'yyyy-MM-dd HH:mm:ss') : '',
        pkg ? 'NA' : (b.paymentStatus || ''),
        b.kitRental ? 'Yes' : 'No',
        b.kitRentalCharge != null ? b.kitRentalCharge.toString() : '',
        refundStatus,
        refundAmount,
        refundMethodCol,
      ];
    });

    // Escape EVERY cell: quote when it contains a comma, double-quote,
    // or newline (doubling embedded quotes per RFC 4180). Without this a
    // machine / coach / player name containing a comma shifted every
    // following column, which is what made the export look "wrong".
    const escapeCsv = (val: unknown): string => {
      if (val === null || val === undefined) return '';
      const s = String(val);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    // Prefix a UTF-8 BOM so Excel renders non-ASCII names correctly and use
    // CRLF line endings (the CSV/Excel standard).
    const csv = '\uFEFF' + [
      headers.map(escapeCsv).join(','),
      ...rows.map((r) => r.map(escapeCsv).join(',')),
    ].join('\r\n');

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename=bookings-export-${formatIST(new Date(), 'yyyy-MM-dd')}.csv`,
      },
    });
  } catch (error: any) {
    console.error('Admin bookings export error:', error);
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}
