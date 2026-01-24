import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/jwt';
import { startOfDay, parseISO, isAfter } from 'date-fns';
import { getServerSession } from "next-auth/next";

export async function POST(req: NextRequest) {
  try {
    let userId: string | undefined;
    let userName: string | undefined;

    // Check for NextAuth session
    const session = await getServerSession();
    if (session?.user?.email) {
      const dbUser = await prisma.user.findUnique({
        where: { email: session.user.email },
      });
      userId = dbUser?.id;
      userName = dbUser?.name || undefined;
    }

    // Check for JWT token if no NextAuth session
    if (!userId) {
      const token = req.cookies.get('token')?.value;
      const decoded = token ? (verifyToken(token) as any) : null;
      if (decoded?.userId) {
        userId = decoded.userId;
        const dbUser = await prisma.user.findUnique({
          where: { id: userId },
        });
        userName = dbUser?.name || undefined;
      }
    }

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

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
      // Machine A supports: LEATHER, MACHINE
      // Machine B supports: TENNIS
      const machineABalls = ['LEATHER', 'MACHINE'];
      const machineBBalls = ['TENNIS'];

      if (!machineABalls.includes(ballType) && !machineBBalls.includes(ballType)) {
        return NextResponse.json({ error: 'Invalid ball type' }, { status: 400 });
      }

      // No slots in the past
      if (!isAfter(start, new Date())) {
        return NextResponse.json({ error: 'Cannot book in the past' }, { status: 400 });
      }

      // Use DB transaction to prevent double booking
      const result = await prisma.$transaction(async (tx) => {
        // Check for overlapping bookings on the same machine
        const isMachineA = machineABalls.includes(ballType);
        const relevantBallTypes = isMachineA ? machineABalls : machineBBalls;

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
