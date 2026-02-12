import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/adminAuth';
import { generateSlotsForDate } from '@/lib/time';
import { parseISO, startOfDay, addDays } from 'date-fns';

export async function POST(req: NextRequest) {
  try {
    const session = await requireAdmin(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { fromDate, toDate: toDateStr, price = 600, startHour, endHour, duration } = await req.json();

    if (!fromDate || !toDateStr) {
      return NextResponse.json({ error: 'fromDate and toDate are required' }, { status: 400 });
    }

    const from = parseISO(fromDate);
    const to = parseISO(toDateStr);

    if (from > to) {
      return NextResponse.json({ error: 'fromDate must be before or equal to toDate' }, { status: 400 });
    }

    // Fetch policies for defaults
    const policies = await prisma.policy.findMany({
      where: {
        key: { in: ['SLOT_WINDOW_START', 'SLOT_WINDOW_END', 'SLOT_DURATION', 'DEFAULT_SLOT_PRICE'] },
      },
    });
    const policyMap = Object.fromEntries(policies.map(p => [p.key, p.value]));

    const config = {
      startHour: startHour ?? (policyMap['SLOT_WINDOW_START'] ? parseInt(policyMap['SLOT_WINDOW_START']) : undefined),
      endHour: endHour ?? (policyMap['SLOT_WINDOW_END'] ? parseInt(policyMap['SLOT_WINDOW_END']) : undefined),
      duration: duration ?? (policyMap['SLOT_DURATION'] ? parseInt(policyMap['SLOT_DURATION']) : undefined),
    };

    const slotPrice = Number(price) || (policyMap['DEFAULT_SLOT_PRICE'] ? parseFloat(policyMap['DEFAULT_SLOT_PRICE']) : 600);

    const slotsToCreate: Array<{
      date: Date;
      startTime: Date;
      endTime: Date;
      price: number;
    }> = [];

    let currentDate = from;
    while (currentDate <= to) {
      const daySlots = generateSlotsForDate(currentDate, config);
      for (const slot of daySlots) {
        slotsToCreate.push({
          date: startOfDay(currentDate),
          startTime: slot.startTime,
          endTime: slot.endTime,
          price: slotPrice,
        });
      }
      currentDate = addDays(currentDate, 1);
    }

    // Filter out slots that already exist
    let existingSlots: { date: Date; startTime: Date }[] = [];
    try {
      existingSlots = await prisma.slot.findMany({
        where: {
          date: {
            gte: startOfDay(from),
            lte: startOfDay(to),
          },
        },
        select: { date: true, startTime: true },
      });
    } catch (err: any) {
      if (err?.message?.includes('does not exist in the current database') || err?.code === 'P2021') {
        return NextResponse.json(
          { error: 'Slot management is unavailable. Database migrations need to be applied. Run: npx prisma migrate deploy' },
          { status: 503 }
        );
      }
      throw err;
    }

    const existingSet = new Set(
      existingSlots.map(s => `${s.date.toISOString()}_${s.startTime.toISOString()}`)
    );

    const newSlots = slotsToCreate.filter(
      s => !existingSet.has(`${s.date.toISOString()}_${s.startTime.toISOString()}`)
    );

    if (newSlots.length === 0) {
      return NextResponse.json({
        message: 'All slots already exist for the given date range',
        created: 0,
        skipped: slotsToCreate.length,
      });
    }

    const result = await prisma.slot.createMany({
      data: newSlots,
      skipDuplicates: true,
    });

    return NextResponse.json({
      message: `Created ${result.count} slots`,
      created: result.count,
      skipped: slotsToCreate.length - result.count,
    });
  } catch (error: any) {
    console.error('Admin bulk slot create error:', error);
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}
