import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Prisma, type BallType, type PitchType, type OperationMode, type MachineId } from '@prisma/client';
import { isAfter, isValid } from 'date-fns';
import { getAuthenticatedUser } from '@/lib/auth';
import {
  getRelevantBallTypes, isValidBallType, MACHINE_A_BALLS,
  isValidMachineId, getBallTypeForMachine, getMachineCategory, LEATHER_MACHINES, MACHINES,
} from '@/lib/constants';
import { dateStringToUTC, formatIST } from '@/lib/time';
import { notifyBookingConfirmed } from '@/lib/notifications';
import { getPricingConfig, getTimeSlabConfig, calculateNewPricing, getTimeSlab } from '@/lib/pricing';
import { getCachedPolicies } from '@/lib/policy-cache';
import { validatePackageBooking } from '@/lib/packages';
import { debitWallet, rollbackWalletDebit, isWalletEnabled, getWalletBalance } from '@/lib/wallet';
import { autoAssignOperator, getOperatorCount } from '@/lib/operatorAssign';

async function getMachineConfig() {
  const config = await getCachedPolicies([
    'BALL_TYPE_SELECTION_ENABLED',
    'LEATHER_BALL_EXTRA_CHARGE',
    'MACHINE_BALL_EXTRA_CHARGE',
    'PITCH_TYPE_SELECTION_ENABLED',
    'ASTRO_PITCH_PRICE',
    'TURF_PITCH_PRICE',
    'NUMBER_OF_OPERATORS',
  ]);

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
  return ['ASTRO', 'CEMENT', 'NATURAL', 'TURF'].includes(val);
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

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const slotsToBook = Array.isArray(body) ? body : [body];

    if (slotsToBook.length === 0) {
      return NextResponse.json({ error: 'No slots provided' }, { status: 400 });
    }

    const isAdmin = user.role === 'ADMIN';
    const isSuperAdmin = !!user.isSuperAdmin;
    const createdBy = user.name || user.id;
    const userId = (isAdmin && slotsToBook[0]?.userId) || user.id;

    // Fetch the target user info
    const targetUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Free booking: superadmin bookings OR target user is marked as free user
    const isFreeBooking = isSuperAdmin || targetUser.isFreeUser;

    if (targetUser.isBlacklisted) {
      return NextResponse.json({ error: 'Your account is blocked. Please contact admin.' }, { status: 403 });
    }

    let userName = targetUser.name;

    // Check if this is a package-based booking
    const userPackageId = slotsToBook[0]?.userPackageId as string | undefined;

    // Check payment method
    const requestedPaymentMethod = slotsToBook[0]?.paymentMethod as string | undefined;
    const isCashPayment = requestedPaymentMethod === 'CASH';
    const isWalletPayment = requestedPaymentMethod === 'WALLET';

    // Kit rental - read config from policy (server-side truth)
    const kitRentalRequested = !!slotsToBook[0]?.kitRental;
    let kitRental = false;
    let kitRentalCharge = 0;
    if (kitRentalRequested) {
      const kitRentalPolicy = await prisma.policy.findUnique({ where: { key: 'KIT_RENTAL_CONFIG' } });
      const kitConfig = kitRentalPolicy ? (() => { try { return JSON.parse(kitRentalPolicy.value); } catch { return null; } })() : null;
      const isKitEnabled = kitConfig?.enabled ?? false;
      const kitMachines: string[] = kitConfig?.machines ?? ['GRAVITY', 'YANTRA'];
      const firstMachineIdRaw = slotsToBook[0]?.machineId as string | undefined;
      if (isKitEnabled && firstMachineIdRaw && kitMachines.includes(firstMachineIdRaw)) {
        kitRental = true;
        kitRentalCharge = kitConfig?.price ?? 200;
      }
    }

    // Server-side: reject cash payment if disabled globally and user has no cash access
    if (isCashPayment) {
      const [cashPolicy, cashPaymentUser] = await Promise.all([
        prisma.policy.findUnique({ where: { key: 'CASH_PAYMENT_ENABLED' } }),
        prisma.cashPaymentUser.findUnique({ where: { userId: user.id } }),
      ]);
      const globalCashEnabled = cashPolicy?.value === 'true';
      if (!globalCashEnabled && !cashPaymentUser) {
        return NextResponse.json({ error: 'Cash payment is not available.' }, { status: 400 });
      }
    }

    // Fetch configs in parallel
    const [machineConfig, pricingConfig, timeSlabConfig] = await Promise.all([
      getMachineConfig(),
      getPricingConfig(),
      getTimeSlabConfig(),
    ]);

    // Validate all slots first
    const validatedSlots: Array<{
      date: Date;
      startTime: Date;
      endTime: Date;
      ballType: BallType;
      machineId: MachineId | null;
      pitchType: PitchType | null;
      operationMode: OperationMode;
      playerName: string;
    }> = [];

    for (const slotData of slotsToBook) {
      const { date, startTime, endTime, pitchType, operationMode } = slotData as {
        date: string;
        startTime: string;
        endTime: string;
        ballType?: string;
        machineId?: string;
        pitchType?: string;
        operationMode?: string;
        playerName?: string;
      };
      let { playerName, ballType: ballTypeParam = 'TENNIS', machineId: machineIdParam } = slotData as {
        playerName?: string;
        ballType?: string;
        machineId?: string;
      };

      if ((!playerName || playerName === 'Guest') && userName) {
        playerName = userName;
      }

      // Determine machineId and ballType
      let resolvedMachineId: MachineId | null = null;
      let resolvedBallType: BallType;

      if (machineIdParam && isValidMachineId(machineIdParam)) {
        resolvedMachineId = machineIdParam as MachineId;
        resolvedBallType = getBallTypeForMachine(resolvedMachineId);
      } else {
        // Legacy: use ballType directly
        if (!isValidBallType(ballTypeParam)) {
          return NextResponse.json({ error: 'Invalid ball type' }, { status: 400 });
        }
        resolvedBallType = ballTypeParam as BallType;
      }

      if (!date || !startTime || !endTime || !playerName) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
      }

      // Determine operation mode
      let resolvedOperationMode: OperationMode = 'WITH_OPERATOR';
      const isLeather = resolvedMachineId
        ? LEATHER_MACHINES.includes(resolvedMachineId)
        : MACHINE_A_BALLS.includes(resolvedBallType);

      if (isLeather) {
        resolvedOperationMode = 'WITH_OPERATOR';
      } else if (operationMode && isValidOperationMode(operationMode)) {
        resolvedOperationMode = operationMode as OperationMode;
      }

      // Validate pitch type
      let validatedPitchType: PitchType | null = null;
      if (pitchType && isValidPitchType(pitchType)) {
        validatedPitchType = pitchType as PitchType;
      } else if (resolvedBallType === 'TENNIS' && machineConfig.pitchTypeSelectionEnabled && pitchType) {
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

      if (!isAdmin && !isAfter(start, new Date())) {
        return NextResponse.json({ error: 'Cannot book in the past' }, { status: 400 });
      }

      validatedSlots.push({
        date: bookingDate,
        startTime: start,
        endTime: end,
        ballType: resolvedBallType,
        machineId: resolvedMachineId,
        pitchType: validatedPitchType,
        operationMode: resolvedOperationMode,
        playerName,
      });
    }

    // Determine category for pricing
    const firstBallType = validatedSlots[0].ballType;
    const firstMachineId = validatedSlots[0].machineId;
    const category: 'MACHINE' | 'TENNIS' = MACHINE_A_BALLS.includes(firstBallType) ? 'MACHINE' : 'TENNIS';
    const pitchTypeForPricing = validatedSlots[0].pitchType;

    // Calculate pricing using the new model (pass machineId for machine-specific tiers like Yantra)
    const pricing = calculateNewPricing(
      validatedSlots.map(s => ({ startTime: s.startTime, endTime: s.endTime })),
      category,
      firstBallType,
      pitchTypeForPricing,
      timeSlabConfig,
      pricingConfig,
      firstMachineId
    );

    // ── Recurring Slot Discount (Feature 1) ──────────────────────────
    // After consecutive pricing, check for recurring slot discounts and apply as additional flat reduction.
    const recurringDiscountRules = await prisma.recurringSlotDiscount.findMany({
      where: { enabled: true },
    }).catch(() => []);

    let totalRecurringDiscount = 0;
    const isConsecutive = validatedSlots.length >= 2;

    // Helper: get IST hours/minutes from a Date reliably (avoids locale-dependent formatting)
    const getISTTime = (d: Date): string => {
      const utcMs = d.getTime();
      const istMs = utcMs + (5 * 60 + 30) * 60 * 1000;
      const istDate = new Date(istMs);
      const h = istDate.getUTCHours().toString().padStart(2, '0');
      const m = istDate.getUTCMinutes().toString().padStart(2, '0');
      return `${h}:${m}`;
    };
    const getISTDay = (d: Date): number => {
      const utcMs = d.getTime();
      const istMs = utcMs + (5 * 60 + 30) * 60 * 1000;
      return new Date(istMs).getUTCDay();
    };

    // Check each slot against recurring discount rules — apply per qualifying slot
    const perSlotDiscount = isConsecutive ? 'twoSlotDiscount' : 'oneSlotDiscount';
    for (let i = 0; i < pricing.length; i++) {
      const slot = validatedSlots[i];
      const dayOfWeek = getISTDay(slot.startTime);
      const istTimeStr = getISTTime(slot.startTime);

      for (const rule of recurringDiscountRules) {
        if (!rule.days.includes(dayOfWeek)) continue;
        const ruleStartTime = rule.slotStartTime.padStart(5, '0');
        const ruleEndTime = (rule.slotEndTime || rule.slotStartTime).padStart(5, '0');
        if (istTimeStr < ruleStartTime || istTimeStr >= ruleEndTime) continue;
        if (rule.machineId && rule.machineId !== firstMachineId) continue;

        // Apply discount to this qualifying slot
        const discountAmount = rule[perSlotDiscount];
        const maxReduction = Math.min(discountAmount, pricing[i].price);
        pricing[i].price = Math.max(0, pricing[i].price - maxReduction);
        pricing[i].discountAmount += maxReduction;
        totalRecurringDiscount += maxReduction;
        break; // first matching rule wins for this slot
      }
    }

    // If wallet payment, validate balance upfront
    const slotsTotalPrice = isFreeBooking ? 0 : pricing.reduce((sum, p) => sum + p.price, 0);
    const totalKitRentalCharge = kitRental ? kitRentalCharge * validatedSlots.length : 0;
    const totalPrice = slotsTotalPrice + totalKitRentalCharge;
    const totalRecurringDiscountDisplay = totalRecurringDiscount; // For notification display
    if (isWalletPayment && !isFreeBooking && !userPackageId) {
      const walletEnabled = await isWalletEnabled();
      if (!walletEnabled) {
        return NextResponse.json({ error: 'Wallet payments are not enabled' }, { status: 400 });
      }
      const balance = await getWalletBalance(userId!);
      if (balance < totalPrice) {
        return NextResponse.json({
          error: `Insufficient wallet balance. Required: ₹${totalPrice}, Available: ₹${balance}`,
        }, { status: 400 });
      }
    }

    // If package booking, validate each slot individually to handle mixed time slabs
    let packageValidation: { valid: boolean; extraCharge?: number; extraChargeType?: string } | null = null;
    let perSlotExtraCharges: number[] = [];
    if (userPackageId) {
      // First validate with the first slot for session count and basic compatibility
      const firstSlot = validatedSlots[0];
      packageValidation = await validatePackageBooking(
        userPackageId,
        userId!,
        firstSlot.ballType,
        firstSlot.pitchType,
        firstSlot.startTime,
        validatedSlots.length,
        timeSlabConfig,
        firstSlot.machineId
      );

      if (!packageValidation.valid) {
        return NextResponse.json({ error: (packageValidation as any).error || 'Package validation failed' }, { status: 400 });
      }

      // Now validate each slot individually to get per-slot extra charges (handles mixed time slabs)
      let totalExtraCharge = 0;
      for (const slot of validatedSlots) {
        const slotValidation = await validatePackageBooking(
          userPackageId,
          userId!,
          slot.ballType,
          slot.pitchType,
          slot.startTime,
          1, // Validate one slot at a time for pricing
          timeSlabConfig,
          slot.machineId
        );
        const slotExtra = slotValidation.valid ? (slotValidation.extraCharge || 0) : 0;
        perSlotExtraCharges.push(slotExtra);
        totalExtraCharge += slotExtra;
      }
      // Override the total extra charge with the per-slot sum
      packageValidation.extraCharge = totalExtraCharge;
    }

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

            // Conflict check: use machineId if available, otherwise fall back to ballType
            const conflictWhere: any = {
              date: slot.date,
              startTime: slot.startTime,
              status: 'BOOKED',
            };
            if (slot.machineId) {
              conflictWhere.machineId = slot.machineId;
              if (slot.pitchType) {
                conflictWhere.pitchType = slot.pitchType;
              }
            } else {
              conflictWhere.ballType = { in: relevantBallTypes };
              if (isTennisMachine && slot.pitchType) {
                conflictWhere.pitchType = slot.pitchType;
              }
            }

            const existingBooked = await tx.booking.findFirst({
              where: conflictWhere,
              select: { id: true },
            });

            if (existingBooked) {
              throw new BookingConflictError(`Slot at ${slotTime} is already booked`);
            }

            // Operator constraint check — use per-day/slab operator count
            if (requiresOperator) {
              const slotTimeSlab = getTimeSlab(slot.startTime, timeSlabConfig);
              const numberOfOperators = await getOperatorCount(slot.date, slot.startTime, timeSlabConfig);

              const operatorWhere: Prisma.BookingWhereInput = {
                date: slot.date,
                startTime: slot.startTime,
                status: 'BOOKED',
                OR: [
                  { ballType: { in: MACHINE_A_BALLS } },
                  { ballType: 'TENNIS', operationMode: 'WITH_OPERATOR' },
                ],
              };

              const operatorBookings = await tx.booking.findMany({
                where: operatorWhere,
                select: { id: true },
              });
              const operatorsUsed = operatorBookings.length;

              if (operatorsUsed >= numberOfOperators) {
                throw new OperatorUnavailableError(
                  `Operator not available for slot at ${slotTime}. All ${numberOfOperators} operator(s) are already booked.`
                );
              }
            }

            // Check for existing booking with same machine + pitch type
            const upsertWhere: any = {
              date: slot.date,
              startTime: slot.startTime,
            };
            if (slot.machineId) {
              upsertWhere.machineId = slot.machineId;
            } else {
              upsertWhere.ballType = slot.ballType;
            }
            if ((slot.machineId || isTennisMachine) && slot.pitchType) {
              upsertWhere.pitchType = slot.pitchType;
            }

            const existingSameConfig = await tx.booking.findFirst({
              where: upsertWhere,
              select: { id: true },
            });

            // Free bookings: superadmin or free user
            const effectivePrice = isFreeBooking ? 0 : priceInfo.price;
            const effectiveOriginalPrice = isFreeBooking ? 0 : priceInfo.originalPrice;
            const effectiveDiscountAmount = isFreeBooking ? null : (priceInfo.discountAmount || null);
            const effectiveDiscountType = isFreeBooking ? null : (priceInfo.discountAmount > 0 ? 'FIXED' as const : null);

            // Determine payment fields (only for non-free bookings)
            const paymentFields = !isFreeBooking
              ? isWalletPayment
                ? { paymentMethod: 'WALLET' as const, paymentStatus: 'PAID' as const }
                : isCashPayment
                  ? { paymentMethod: 'CASH' as const, paymentStatus: 'PENDING' as const }
                  : { paymentMethod: 'ONLINE' as const, paymentStatus: 'PAID' as const }
              : {};

            // Auto-assign operator for WITH_OPERATOR bookings (pass timeSlab for Feature 2)
            let assignedOperatorId: string | null = null;
            if (requiresOperator) {
              const slotTimeSlab = getTimeSlab(slot.startTime, timeSlabConfig);
              assignedOperatorId = await autoAssignOperator(slot.date, slot.startTime, tx, slot.machineId, slotTimeSlab);
            }

            // Kit rental: add per-slot charge to the booking price
            const slotKitCharge = kitRental ? kitRentalCharge : 0;
            const priceWithKit = effectivePrice + slotKitCharge;

            const bookingData: Prisma.BookingUncheckedCreateInput = {
              userId: userId!,
              date: slot.date,
              startTime: slot.startTime,
              endTime: slot.endTime,
              status: 'BOOKED',
              ballType: slot.ballType,
              playerName: slot.playerName,
              createdBy,
              isSuperAdminBooking: isFreeBooking,
              operationMode: slot.operationMode,
              price: priceWithKit,
              originalPrice: effectiveOriginalPrice,
              discountAmount: effectiveDiscountAmount,
              discountType: effectiveDiscountType,
              kitRental,
              kitRentalCharge: kitRental ? kitRentalCharge : null,
              ...(slot.machineId ? { machineId: slot.machineId } : {}),
              ...(slot.pitchType !== null ? { pitchType: slot.pitchType } : {}),
              ...(assignedOperatorId ? { operatorId: assignedOperatorId } : {}),
              ...paymentFields,
            };

            const updateData: Prisma.BookingUncheckedUpdateInput = {
              userId: userId!,
              endTime: slot.endTime,
              status: 'BOOKED',
              playerName: slot.playerName,
              createdBy,
              isSuperAdminBooking: isFreeBooking,
              operationMode: slot.operationMode,
              price: priceWithKit,
              originalPrice: effectiveOriginalPrice,
              discountAmount: effectiveDiscountAmount,
              discountType: effectiveDiscountType,
              kitRental,
              kitRentalCharge: kitRental ? kitRentalCharge : null,
              ...(slot.machineId ? { machineId: slot.machineId } : {}),
              ...(slot.pitchType !== null ? { pitchType: slot.pitchType } : {}),
              ...(assignedOperatorId ? { operatorId: assignedOperatorId } : {}),
              ...paymentFields,
            };

            try {
              if (existingSameConfig) {
                return await tx.booking.update({
                  where: { id: existingSameConfig.id },
                  data: updateData,
                  select: { id: true, status: true },
                });
              }

              return await tx.booking.create({
                data: bookingData,
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

    // If package booking, deduct sessions and create PackageBooking records
    if (userPackageId && packageValidation) {
      // Check if this is the first booking for this package (activates validity)
      const currentUserPackage = await prisma.userPackage.findUnique({
        where: { id: userPackageId },
        include: { package: true },
      });

      for (let idx = 0; idx < results.length; idx++) {
        const result = results[idx];
        const slotExtra = perSlotExtraCharges[idx] ?? 0;
        await prisma.packageBooking.upsert({
          where: { bookingId: result.id },
          create: {
            userPackageId,
            bookingId: result.id,
            sessionsUsed: 1,
            extraCharge: slotExtra,
            extraChargeType: slotExtra > 0 ? (packageValidation.extraChargeType || null) : null,
          },
          update: {},
        });
      }

      // If first booking (usedSessions was 0), activate validity period now
      const isFirstBooking = currentUserPackage && currentUserPackage.usedSessions === 0;
      const updateData: any = {
        usedSessions: { increment: validatedSlots.length },
      };

      if (isFirstBooking && currentUserPackage.package) {
        const now = new Date();
        const expiry = new Date(now);
        expiry.setDate(expiry.getDate() + currentUserPackage.package.validityDays);
        updateData.activationDate = now;
        updateData.expiryDate = expiry;
      }

      await prisma.userPackage.update({
        where: { id: userPackageId },
        data: updateData,
      });
    }

    // Debit wallet if wallet payment was selected
    let walletDebitResult: { transactionId: string; newBalance: number } | null = null;
    if (isWalletPayment && !isFreeBooking && !userPackageId && totalPrice > 0) {
      try {
        const bookingIds = results.map(r => r.id).join(', ');
        const result = await debitWallet(
          userId!,
          totalPrice,
          'DEBIT_BOOKING',
          `Booking payment (${results.length} slot${results.length > 1 ? 's' : ''})`,
          results[0].id,
        );
        walletDebitResult = {
          transactionId: result.transactionId,
          newBalance: result.newBalance,
        };
      } catch (walletErr) {
        // Wallet debit failed — cancel the bookings we just created
        console.error('Wallet debit failed, rolling back bookings:', walletErr);
        try {
          await prisma.booking.updateMany({
            where: { id: { in: results.map(r => r.id) } },
            data: {
              status: 'CANCELLED',
              cancelledBy: 'System',
              cancellationReason: 'Wallet payment failed',
            },
          });
        } catch (rollbackErr) {
          console.error('Failed to rollback bookings after wallet failure:', rollbackErr);
        }
        const msg = walletErr instanceof Error ? walletErr.message : 'Wallet payment failed';
        return NextResponse.json({ error: msg }, { status: 400 });
      }
    }

    // Create booking confirmation notification
    try {
      const firstSlot = validatedSlots[0];
      const machineName = firstSlot.machineId ? MACHINES[firstSlot.machineId]?.shortName : (firstBallType === 'TENNIS' ? 'Tennis' : 'Leather');
      const dateStr = formatIST(firstSlot.date, 'EEE, dd MMM yyyy');
      const timeStr = formatIST(firstSlot.startTime, 'hh:mm a');
      const endTimeStr = formatIST(validatedSlots[validatedSlots.length - 1].endTime, 'hh:mm a');
      const slotCount = validatedSlots.length;

      const lines = [
        `${dateStr}`,
        `${timeStr} – ${endTimeStr} (${slotCount} slot${slotCount > 1 ? 's' : ''})`,
        `Machine: ${machineName}`,
      ];
      if (firstSlot.pitchType) lines.push(`Pitch: ${firstSlot.pitchType}`);
      if (isFreeBooking) {
        lines.push('Price: FREE');
      } else if (isWalletPayment && walletDebitResult) {
        lines.push(`Price: ₹${totalPrice} (Wallet — Balance: ₹${walletDebitResult.newBalance})`);
      } else if (isCashPayment) {
        lines.push(`Price: ₹${totalPrice} (Pay at center)`);
      } else if (!userPackageId) {
        lines.push(`Price: ₹${totalPrice}`);
      }
      if (userPackageId) lines.push('Booked via package');

      // Fetch user mobile for WhatsApp notification
      const notifUser = await prisma.user.findUnique({
        where: { id: userId! },
        select: { mobileNumber: true, mobileVerified: true },
      });

      // Fetch assigned operator details from the booking record
      let operatorName: string | undefined;
      let operatorPhone: string | undefined;
      if (results[0]?.id) {
        const booking = await prisma.booking.findUnique({
          where: { id: results[0].id },
          select: { operatorId: true },
        });
        if (booking?.operatorId) {
          const operator = await prisma.user.findUnique({
            where: { id: booking.operatorId },
            select: { name: true, mobileNumber: true },
          });
          if (operator) {
            operatorName = operator.name || undefined;
            operatorPhone = operator.mobileNumber || undefined;
          }
        }
      }

      // Build price string
      let priceStr = '';
      if (isFreeBooking) priceStr = 'FREE';
      else if (isWalletPayment && walletDebitResult) priceStr = `₹${totalPrice} (Wallet)`;
      else if (isCashPayment) priceStr = `₹${totalPrice} (Pay at center)`;
      else if (userPackageId) priceStr = 'Package session';
      else priceStr = `₹${totalPrice}`;

      // Pitch label
      const pitchLabels: Record<string, string> = {
        ASTRO: 'Astro Turf', CEMENT: 'Cement', NATURAL: 'Natural Turf', TURF: 'Cement Wicket',
      };
      const pitchLabel = firstSlot.pitchType ? (pitchLabels[firstSlot.pitchType] || firstSlot.pitchType) : 'N/A';

      await notifyBookingConfirmed(userId!, {
        date: dateStr,
        time: `${timeStr} – ${endTimeStr} (${slotCount} slot${slotCount > 1 ? 's' : ''})`,
        machine: machineName || 'N/A',
        pitch: pitchLabel,
        price: priceStr,
        operatorName,
        operatorPhone,
        mobileNumber: notifUser?.mobileVerified ? notifUser.mobileNumber : null,
      });
    } catch (notifErr) {
      console.error('Failed to create booking notification:', notifErr);
    }

    const response = Array.isArray(body) ? results : results[0];
    return NextResponse.json(response);
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
