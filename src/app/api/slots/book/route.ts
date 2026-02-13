import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Prisma, type BallType, type PitchType, type OperationMode } from '@prisma/client';
import { isAfter, isValid } from 'date-fns';
import { getAuthenticatedUser } from '@/lib/auth';
import { getRelevantBallTypes, isValidBallType, MACHINE_A_BALLS } from '@/lib/constants';
import { dateStringToUTC } from '@/lib/time';
import { getPricingConfig, getTimeSlabConfig, calculateNewPricing } from '@/lib/pricing';

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
          'NUMBER_OF_OPERATORS',
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
    numberOfOperators: parseInt(config['NUMBER_OF_OPERATORS'] || '1', 10),
  };
}

function isValidPitchType(val: string): val is PitchType {
  return ['ASTRO', 'TURF'].includes(val);
}

function isValidOperationMode(val: string): val is OperationMode {
  return ['WITH_OPERATOR', 'SELF_OPERATE'].includes(val);
}

const MAX_TRANSACTION_RETRIES = 3;

class BookingConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BookingConflictError';
  }
}

class OperatorUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OperatorUnavailableError';
  }
}

function isSerializableConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2034'
  );
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

function isTransactionAborted(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientUnknownRequestError &&
    error.message.includes('25P02')
  );
}

type BookingColumnSupport = {
  operationMode: boolean;
  price: boolean;
  originalPrice: boolean;
  discountAmount: boolean;
  discountType: boolean;
  pitchType: boolean;
  extraCharge: boolean;
};

async function getBookingColumnSupport(): Promise<BookingColumnSupport> {
  try {
    const columns = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'Booking'
    `;
    const columnSet = new Set(columns.map((c) => c.column_name));

    return {
      operationMode: columnSet.has('operationMode'),
      price: columnSet.has('price'),
      originalPrice: columnSet.has('originalPrice'),
      discountAmount: columnSet.has('discountAmount'),
      discountType: columnSet.has('discountType'),
      pitchType: columnSet.has('pitchType'),
      extraCharge: columnSet.has('extraCharge'),
    };
  } catch {
    return {
      operationMode: false,
      price: false,
      originalPrice: false,
      discountAmount: false,
      discountType: false,
      pitchType: false,
      extraCharge: false,
    };
  }
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
    const bookingColumns = await getBookingColumnSupport();
    const [pricingConfig, timeSlabConfig] = await Promise.all([
      getPricingConfig(),
      getTimeSlabConfig(),
    ]);

    // Validate all slots first
    const validatedSlots: Array<{
      date: Date;
      startTime: Date;
      endTime: Date;
      ballType: BallType;
      pitchType: PitchType | null;
      operationMode: OperationMode;
      playerName: string;
    }> = [];

    for (const slotData of slotsToBook) {
      const { date, startTime, endTime, ballType = 'TENNIS', pitchType, operationMode } = slotData as {
        date: string;
        startTime: string;
        endTime: string;
        ballType?: string;
        pitchType?: string;
        operationMode?: string;
        playerName?: string;
      };
      let { playerName } = slotData as { playerName?: string };

      if ((!playerName || playerName === 'Guest') && userName) {
        playerName = userName;
      }

      if (!date || !startTime || !endTime || !playerName || !ballType) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
      }

      if (!isValidBallType(ballType)) {
        return NextResponse.json({ error: 'Invalid ball type' }, { status: 400 });
      }

      // Determine operation mode
      let resolvedOperationMode: OperationMode = 'WITH_OPERATOR';
      if (MACHINE_A_BALLS.includes(ballType as BallType)) {
        resolvedOperationMode = 'WITH_OPERATOR';
      } else if (operationMode && isValidOperationMode(operationMode)) {
        resolvedOperationMode = operationMode as OperationMode;
      }

      // Validate pitch type for Tennis Machine
      let validatedPitchType: PitchType | null = null;
      if (ballType === 'TENNIS' && machineConfig.pitchTypeSelectionEnabled && pitchType) {
        if (!isValidPitchType(pitchType)) {
          return NextResponse.json({ error: 'Invalid pitch type' }, { status: 400 });
        }
        validatedPitchType = pitchType as PitchType;
      }

      const bookingDate = dateStringToUTC(date);
      const start = new Date(startTime);
      const end = new Date(endTime);

      if (!isValid(bookingDate) || !isValid(start) || !isValid(end)) {
        return NextResponse.json({ error: 'Invalid date/time values' }, { status: 400 });
      }

      if (!isAfter(end, start)) {
        return NextResponse.json({ error: 'End time must be after start time' }, { status: 400 });
      }

      if (!isAfter(start, new Date())) {
        return NextResponse.json({ error: 'Cannot book in the past' }, { status: 400 });
      }

      validatedSlots.push({
        date: bookingDate,
        startTime: start,
        endTime: end,
        ballType: ballType as BallType,
        pitchType: validatedPitchType,
        operationMode: resolvedOperationMode,
        playerName,
      });
    }

    // Determine category for pricing
    const firstBallType = validatedSlots[0].ballType;
    const category: 'MACHINE' | 'TENNIS' = MACHINE_A_BALLS.includes(firstBallType) ? 'MACHINE' : 'TENNIS';
    const pitchTypeForPricing = validatedSlots[0].pitchType;

    // Calculate pricing using the new model
    const pricing = calculateNewPricing(
      validatedSlots.map(s => ({ startTime: s.startTime, endTime: s.endTime })),
      category,
      firstBallType,
      pitchTypeForPricing,
      timeSlabConfig,
      pricingConfig
    );

    // Book all slots in transaction
    const results: Array<{ id: string; status: string }> = [];
    for (let i = 0; i < validatedSlots.length; i++) {
      const slot = validatedSlots[i];
      const priceInfo = pricing[i];

      if (!priceInfo) {
        throw new Error('Pricing not found for slot');
      }

      const slotTime = slot.startTime.toLocaleTimeString();
      const requiresOperator = slot.operationMode === 'WITH_OPERATOR';

      let result: { id: string; status: string } | null = null;
      for (let attempt = 1; attempt <= MAX_TRANSACTION_RETRIES; attempt++) {
        try {
          result = await prisma.$transaction(async (tx) => {
            const relevantBallTypes = getRelevantBallTypes(slot.ballType);
            const isTennisMachine = slot.ballType === 'TENNIS';

            const conflictWhere: any = {
              date: slot.date,
              startTime: slot.startTime,
              ballType: { in: relevantBallTypes },
              status: 'BOOKED',
            };
            if (isTennisMachine && slot.pitchType) {
              conflictWhere.pitchType = slot.pitchType;
            }

            const existingBooked = await tx.booking.findFirst({
              where: conflictWhere,
              select: { id: true },
            });

            if (existingBooked) {
              throw new BookingConflictError(`Slot at ${slotTime} is already booked`);
            }

            // Operator constraint check
            if (requiresOperator) {
              const operatorWhere: Prisma.BookingWhereInput = bookingColumns.operationMode
                ? {
                    date: slot.date,
                    startTime: slot.startTime,
                    status: 'BOOKED',
                    OR: [
                      { ballType: { in: MACHINE_A_BALLS } },
                      { ballType: 'TENNIS', operationMode: 'WITH_OPERATOR' },
                    ],
                  }
                : {
                    date: slot.date,
                    startTime: slot.startTime,
                    status: 'BOOKED',
                  };

              const operatorBookings = await tx.booking.findMany({
                where: operatorWhere,
                select: { id: true },
              });
              const operatorsUsed = operatorBookings.length;

              if (operatorsUsed >= machineConfig.numberOfOperators) {
                throw new OperatorUnavailableError(
                  `Operator not available for slot at ${slotTime}. All ${machineConfig.numberOfOperators} operator(s) are already booked.`
                );
              }
            }

            // Check for existing booking with same ball type + pitch type
            const upsertWhere: any = {
              date: slot.date,
              startTime: slot.startTime,
              ballType: slot.ballType,
            };
            if (isTennisMachine && slot.pitchType) {
              upsertWhere.pitchType = slot.pitchType;
            }

            const existingSameBallType = await tx.booking.findFirst({
              where: upsertWhere,
              select: { id: true },
            });

            const baseBookingData: Prisma.BookingUncheckedCreateInput = {
              userId: userId!,
              date: slot.date,
              startTime: slot.startTime,
              endTime: slot.endTime,
              status: 'BOOKED',
              ballType: slot.ballType,
              playerName: slot.playerName,
            };

            const baseUpdateData: Prisma.BookingUncheckedUpdateInput = {
              userId: userId!,
              endTime: slot.endTime,
              status: 'BOOKED',
              playerName: slot.playerName,
            };

            const fullBookingData: Prisma.BookingUncheckedCreateInput = {
              ...baseBookingData,
              ...(bookingColumns.price ? { price: priceInfo.price } : {}),
              ...(bookingColumns.originalPrice ? { originalPrice: priceInfo.originalPrice } : {}),
              ...(bookingColumns.discountAmount ? { discountAmount: priceInfo.discountAmount || null } : {}),
              ...(bookingColumns.discountType ? { discountType: priceInfo.discountAmount > 0 ? 'FIXED' : null } : {}),
              ...(bookingColumns.operationMode ? { operationMode: slot.operationMode } : {}),
            };

            const fullUpdateData: Prisma.BookingUncheckedUpdateInput = {
              ...baseUpdateData,
              ...(bookingColumns.price ? { price: priceInfo.price } : {}),
              ...(bookingColumns.originalPrice ? { originalPrice: priceInfo.originalPrice } : {}),
              ...(bookingColumns.discountAmount ? { discountAmount: priceInfo.discountAmount || null } : {}),
              ...(bookingColumns.discountType ? { discountType: priceInfo.discountAmount > 0 ? 'FIXED' : null } : {}),
              ...(bookingColumns.operationMode ? { operationMode: slot.operationMode } : {}),
            };

            if (slot.pitchType !== null && bookingColumns.pitchType) {
              fullBookingData.pitchType = slot.pitchType;
              fullUpdateData.pitchType = slot.pitchType;
            }

            try {
              if (existingSameBallType) {
                return await tx.booking.update({
                  where: { id: existingSameBallType.id },
                  data: fullUpdateData,
                  select: { id: true, status: true },
                });
              }

              return await tx.booking.create({
                data: fullBookingData,
                select: { id: true, status: true },
              });
            } catch (error) {
              if (isUniqueConstraintError(error) || isTransactionAborted(error)) {
                throw new BookingConflictError(`Slot at ${slotTime} is already booked`);
              }

              throw error;
            }
          }, {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          });

          break;
        } catch (error) {
          if (error instanceof BookingConflictError || error instanceof OperatorUnavailableError) {
            throw error;
          }

          if (isSerializableConflict(error) && attempt < MAX_TRANSACTION_RETRIES) {
            continue;
          }

          if (isUniqueConstraintError(error) || isTransactionAborted(error)) {
            throw new BookingConflictError(`Slot at ${slotTime} is already booked`);
          }

          throw error;
        }
      }

      if (!result) {
        throw new Error('Unable to complete booking after retries');
      }

      results.push(result);
    }

    return NextResponse.json(Array.isArray(body) ? results : results[0]);
  } catch (error: unknown) {
    if (error instanceof BookingConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof OperatorUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('Booking error:', error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
