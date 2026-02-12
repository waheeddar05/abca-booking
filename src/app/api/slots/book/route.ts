import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { startOfDay, parseISO, isAfter } from 'date-fns';
import { getAuthenticatedUser } from '@/lib/auth';
import { getRelevantBallTypes, isValidBallType, MACHINE_A_BALLS } from '@/lib/constants';
import { getDiscountConfig, calculatePricing, SlotWithPrice } from '@/lib/discount';
import { BallType, PitchType } from '@prisma/client';

async function getMachineConfig() {
  const policies = await prisma.policy.findMany({
    where: {
      key: {
        in: [
          'BALL_TYPE_SELECTION_ENABLED',
          'LEATHER_BALL_EXTRA_CHARGE',
          'MACHINE_BALL_EXTRA_CHARGE',
          'PITCH_TYPE_SELECTION_ENABLED',
          'ASTRO_PITCH_PRICE',
          'TURF_PITCH_PRICE',
        ],
      },
    },
  });
  const config: Record<string, string> = {};
  for (const p of policies) config[p.key] = p.value;

  return {
    ballTypeSelectionEnabled: config['BALL_TYPE_SELECTION_ENABLED'] === 'true',
    leatherBallExtraCharge: parseFloat(config['LEATHER_BALL_EXTRA_CHARGE'] || '100'),
    machineBallExtraCharge: parseFloat(config['MACHINE_BALL_EXTRA_CHARGE'] || '0'),
    pitchTypeSelectionEnabled: config['PITCH_TYPE_SELECTION_ENABLED'] === 'true',
    astroPitchPrice: parseFloat(config['ASTRO_PITCH_PRICE'] || '600'),
    turfPitchPrice: parseFloat(config['TURF_PITCH_PRICE'] || '700'),
  };
}

function isValidPitchType(val: string): val is PitchType {
  return ['ASTRO', 'TURF'].includes(val);
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = user.id;
    const userName = user.name;

    const body = await req.json();
    const slotsToBook = Array.isArray(body) ? body : [body];

    if (slotsToBook.length === 0) {
      return NextResponse.json({ error: 'No slots provided' }, { status: 400 });
    }

    const machineConfig = await getMachineConfig();

    // Validate all slots first
    const validatedSlots: Array<{
      date: Date;
      startTime: Date;
      endTime: Date;
      ballType: BallType;
      pitchType: PitchType | null;
      playerName: string;
      extraCharge: number;
    }> = [];

    for (const slotData of slotsToBook) {
      const { date, startTime, endTime, ballType = 'TENNIS', pitchType } = slotData;
      let { playerName } = slotData;

      if ((!playerName || playerName === 'Guest') && userName) {
        playerName = userName;
      }

      if (!date || !startTime || !endTime || !playerName || !ballType) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
      }

      if (!isValidBallType(ballType)) {
        return NextResponse.json({ error: 'Invalid ball type' }, { status: 400 });
      }

      // Validate pitch type for Tennis Machine
      let validatedPitchType: PitchType | null = null;
      if (ballType === 'TENNIS' && machineConfig.pitchTypeSelectionEnabled && pitchType) {
        if (!isValidPitchType(pitchType)) {
          return NextResponse.json({ error: 'Invalid pitch type' }, { status: 400 });
        }
        validatedPitchType = pitchType as PitchType;
      }

      const start = new Date(startTime);
      if (!isAfter(start, new Date())) {
        return NextResponse.json({ error: 'Cannot book in the past' }, { status: 400 });
      }

      // Calculate extra charge based on ball type / pitch type
      let extraCharge = 0;
      if (MACHINE_A_BALLS.includes(ballType as BallType) && machineConfig.ballTypeSelectionEnabled) {
        if (ballType === 'LEATHER') {
          extraCharge = machineConfig.leatherBallExtraCharge;
        } else if (ballType === 'MACHINE') {
          extraCharge = machineConfig.machineBallExtraCharge;
        }
      }

      validatedSlots.push({
        date: parseISO(date),
        startTime: start,
        endTime: new Date(endTime),
        ballType: ballType as BallType,
        pitchType: validatedPitchType,
        playerName,
        extraCharge,
      });
    }

    // Fetch discount config and slot prices
    const discountConfig = await getDiscountConfig();

    // Lookup slot prices from Slot table, fall back to default
    const slotPrices: SlotWithPrice[] = [];
    for (const slot of validatedSlots) {
      let dbSlotPrice: number | null = null;
      try {
        const dbSlot = await prisma.slot.findFirst({
          where: {
            date: startOfDay(slot.date),
            startTime: slot.startTime,
            isActive: true,
          },
          select: { price: true },
        });
        dbSlotPrice = dbSlot?.price ?? null;
      } catch {
        // Slot table may not exist yet
      }

      let basePrice = dbSlotPrice ?? discountConfig.defaultSlotPrice;

      // For Tennis Machine with pitch type pricing
      if (slot.ballType === 'TENNIS' && slot.pitchType && machineConfig.pitchTypeSelectionEnabled) {
        if (slot.pitchType === 'ASTRO') {
          basePrice = machineConfig.astroPitchPrice;
        } else if (slot.pitchType === 'TURF') {
          basePrice = machineConfig.turfPitchPrice;
        }
      }

      // Add extra charge for ball type
      const totalPrice = basePrice + slot.extraCharge;

      slotPrices.push({
        startTime: slot.startTime,
        endTime: slot.endTime,
        price: totalPrice,
      });
    }

    // Calculate pricing with discount
    const pricing = calculatePricing(slotPrices, discountConfig);

    // Book all slots in transaction
    const results = [];
    for (let i = 0; i < validatedSlots.length; i++) {
      const slot = validatedSlots[i];
      const priceInfo = pricing[i];

      const result = await prisma.$transaction(async (tx) => {
        const relevantBallTypes = getRelevantBallTypes(slot.ballType);

        // Use select to only fetch columns guaranteed to exist
        const existingBooked = await tx.booking.findFirst({
          where: {
            date: {
              gte: startOfDay(slot.date),
              lte: startOfDay(slot.date),
            },
            startTime: slot.startTime,
            ballType: { in: relevantBallTypes as any },
            status: 'BOOKED',
          },
          select: { id: true },
        });

        if (existingBooked) {
          throw new Error(`Slot at ${slot.startTime.toLocaleTimeString()} already booked`);
        }

        const existingSameBallType = await tx.booking.findFirst({
          where: {
            date: {
              gte: startOfDay(slot.date),
              lte: startOfDay(slot.date),
            },
            startTime: slot.startTime,
            ballType: slot.ballType || 'TENNIS',
          },
          select: { id: true },
        });

        // Base booking data (columns that always exist)
        const baseBookingData: any = {
          userId: userId!,
          date: slot.date,
          startTime: slot.startTime,
          endTime: slot.endTime,
          status: 'BOOKED' as const,
          ballType: slot.ballType || 'TENNIS',
          playerName: slot.playerName,
        };

        // Extended data with pricing columns (may not exist if migration not applied)
        const fullBookingData: any = {
          ...baseBookingData,
          price: priceInfo.price,
          originalPrice: priceInfo.originalPrice,
          discountAmount: priceInfo.discountAmount || null,
          discountType: priceInfo.discountType || null,
        };
        if (slot.pitchType !== null) fullBookingData.pitchType = slot.pitchType;
        if (slot.extraCharge) fullBookingData.extraCharge = slot.extraCharge;

        // Try with full data first, fall back to base data if pricing columns don't exist
        try {
          if (existingSameBallType) {
            const { date: _d, startTime: _st, ballType: _bt, ...updateData } = fullBookingData;
            return await tx.booking.update({
              where: { id: existingSameBallType.id },
              data: updateData,
              select: { id: true, status: true },
            });
          }
          return await tx.booking.create({
            data: fullBookingData,
            select: { id: true, status: true },
          });
        } catch (err: any) {
          if (err?.message?.includes('does not exist in the current database')) {
            if (existingSameBallType) {
              const { date: _d, startTime: _st, ballType: _bt, ...updateData } = baseBookingData;
              return await tx.booking.update({
                where: { id: existingSameBallType.id },
                data: updateData,
                select: { id: true, status: true },
              });
            }
            return await tx.booking.create({
              data: baseBookingData,
              select: { id: true, status: true },
            });
          }
          throw err;
        }
      });
      results.push(result);
    }

    return NextResponse.json(Array.isArray(body) ? results : results[0]);
  } catch (error: any) {
    console.error('Booking error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 400 });
  }
}
