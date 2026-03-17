import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/adminAuth';
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

    const where: any = {};
    const todayUTC = getISTTodayUTC();

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

    if (status) {
      where.status = status;
    }

    // Try full query; fall back to safe select if new columns don't exist yet
    let bookings: any[];
    try {
      bookings = await prisma.booking.findMany({
        where,
        include: {
          user: { select: { email: true, mobileNumber: true } },
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
      'Operation Mode',
      'Status',
      'Amount',
      'Created By',
      'Cancelled By',
      'Cancelled At',
      'Payment Method',
      'Payment Status',
      'Refund Status',
      'Refund Amount',
      'Refund Method',
    ];

    const rows = bookings.map((b: any) => {
      const pkg = isPackage(b);

      // Compute refund columns
      const refunds: any[] = b.refunds || [];
      let refundStatus = '';
      let refundAmount = '';
      let refundMethodCol = '';

      if (pkg) {
        refundStatus = 'NA';
        refundAmount = 'NA';
        refundMethodCol = 'NA';
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

      return [
        b.id,
        formatIST(b.date, 'yyyy-MM-dd'),
        formatIST(b.createdAt, 'yyyy-MM-dd HH:mm:ss'),
        formatIST(b.startTime, 'HH:mm'),
        formatIST(b.endTime, 'HH:mm'),
        `"${(b.playerName || '').replace(/"/g, '""')}"`,
        b.user?.email || '',
        b.user?.mobileNumber || '',
        pkg ? 'Package' : 'Regular',
        b.packageBooking?.userPackage?.package?.name || '',
        b.packageBooking?.userPackageId || '',
        b.ballType,
        b.pitchType || '',
        b.machineId || '',
        b.operationMode || '',
        b.status,
        pkg ? 'NA' : (b.price?.toString() || ''),
        `"${(b.createdBy || '').replace(/"/g, '""')}"`,
        `"${(b.cancelledBy || '').replace(/"/g, '""')}"`,
        b.status === 'CANCELLED' && b.updatedAt ? formatIST(b.updatedAt, 'yyyy-MM-dd HH:mm:ss') : '',
        pkg ? 'NA' : (b.paymentMethod || ''),
        pkg ? 'NA' : (b.paymentStatus || ''),
        refundStatus,
        refundAmount,
        refundMethodCol,
      ];
    });

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

    const now = new Date();
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename=bookings-export-${formatIST(now, 'yyyy-MM-dd')}.csv`,
      },
    });
  } catch (error: any) {
    console.error('Admin bookings export error:', error);
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}
