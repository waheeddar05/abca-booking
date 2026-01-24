import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { startOfDay, parseISO, isAfter } from 'date-fns';
import { getAuthenticatedUser } from '@/lib/auth';
import { getRelevantBallTypes, isValidBallType } from '@/lib/constants';

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

    const results = [];
    for (const slotData of slotsToBook) {
      let { date, startTime, endTime, ballType = 'TENNIS', playerName } = slotData;

      // Automatically take playerName from user if not provided or if it's 'Guest'
      if ((!playerName || playerName === 'Guest') && userName) {
        playerName = userName;
      }

      if (!date || !startTime || !endTime || !playerName || !ballType) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
      }

      const bookingDate = parseISO(date);
      const start = new Date(startTime);
      const end = new Date(endTime);

      // Validate ballType and machine constraints
      if (!isValidBallType(ballType)) {
        return NextResponse.json({ error: 'Invalid ball type' }, { status: 400 });
      }

      // No slots in the past
      if (!isAfter(start, new Date())) {
        return NextResponse.json({ error: 'Cannot book in the past' }, { status: 400 });
      }

      // Use DB transaction to prevent double booking
      const result = await prisma.$transaction(async (tx) => {
        // Check for overlapping bookings on the same machine
        const relevantBallTypes = getRelevantBallTypes(ballType);

        const existingBooked = await tx.booking.findFirst({
          where: {
            date: {
              gte: startOfDay(bookingDate),
              lte: startOfDay(bookingDate),
            },
            startTime: start,
            ballType: { in: relevantBallTypes as any },
            status: 'BOOKED',
          },
        });

        if (existingBooked) {
          throw new Error(`Slot at ${start.toLocaleTimeString()} already booked`);
        }

        const existingSameBallType = await tx.booking.findFirst({
          where: {
            date: {
              gte: startOfDay(bookingDate),
              lte: startOfDay(bookingDate),
            },
            startTime: start,
            ballType: ballType || 'TENNIS',
          },
        });

        if (existingSameBallType) {
          // If it exists but is not BOOKED (checked above), it must be CANCELLED.
          // We update it to reuse the record and avoid unique constraint violation.
          return await tx.booking.update({
            where: { id: existingSameBallType.id },
            data: {
              userId: userId!,
              endTime: end,
              status: 'BOOKED',
              playerName: playerName,
            },
          });
        }

        const booking = await tx.booking.create({
          data: {
            userId: userId!,
            date: bookingDate,
            startTime: start,
            endTime: end,
            status: 'BOOKED',
            ballType: ballType || 'TENNIS',
            playerName: playerName,
          },
        });

        return booking;
      });
      results.push(result);
    }

    return NextResponse.json(Array.isArray(body) ? results : results[0]);
  } catch (error: any) {
    console.error('Booking error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 400 });
  }
}
