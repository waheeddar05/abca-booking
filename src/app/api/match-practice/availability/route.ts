import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';
import { resolveCurrentCenter } from '@/lib/centers';
import { sanitizeApiError } from '@/lib/api-errors';
import { dateStringToUTC, getISTDateString } from '@/lib/time';
import {
  getCorporateBatchSettings,
  getMatchSimulationSettings,
  listCorporateSessionDates,
  listMatchSimOccurrences,
  listMonthKeys,
  firstUpcomingSessionInPeriod,
  formatPeriodLabel,
  overlappingPeriods,
  periodsCoveringDate,
  type SessionOccurrence,
} from '@/lib/match-practice';
import {
  filterBlocksForSlotSync,
  evaluateBlockForBooking,
} from '@/lib/resource-booking';
import type { BookingCategory } from '@prisma/client';

/**
 * GET /api/match-practice/availability
 *
 * Everything the Match Practice tab needs in one round-trip:
 *
 *   corporateBatch:
 *     - resolved config (days / window / coach / fees / capacity / half-month)
 *     - months: enrollable periods with live enrolled counts
 *       ("18 of 25 members enrolled") + the derived first-session slot
 *       the client echoes back as the booking's `slots[0]`
 *     - sessions: upcoming regular (per-session) dates with seat counts
 *       ("12 of 25 seats booked")
 *   matchSimulation:
 *     - resolved config + upcoming session occurrences with seat counts
 *       ("2 of 10 slots booked"), multiple sessions per day supported
 *
 * Capacity is display-only here — the booking endpoint re-checks it
 * inside a serializable transaction.
 */

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const SESSION_HORIZON_DAYS = 30;
const MONTH_OPTIONS = 3;

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    const center = await resolveCurrentCenter(req, user);
    if (!center) {
      return NextResponse.json({ error: 'No center selected' }, { status: 400 });
    }
    if (center.bookingModel !== 'RESOURCE_BASED') {
      return NextResponse.json(
        { error: `Center "${center.name}" does not offer match practice bookings` },
        { status: 400 },
      );
    }

    const now = new Date();
    const todayIST = getISTDateString();

    const [corporate, matchSim] = await Promise.all([
      getCorporateBatchSettings(center.id),
      getMatchSimulationSettings(center.id),
    ]);

    // ─── Corporate batch: monthly / half-month enrollment options ────
    const monthKeys = corporate.enabled ? listMonthKeys(MONTH_OPTIONS, todayIST) : [];
    const candidatePeriods: string[] = [];
    for (const mk of monthKeys) {
      candidatePeriods.push(mk);
      if (corporate.halfMonth.enabled && corporate.halfMonth.firstHalf) candidatePeriods.push(`${mk}-H1`);
      if (corporate.halfMonth.enabled && corporate.halfMonth.secondHalf) candidatePeriods.push(`${mk}-H2`);
    }

    // One grouped count covers every period bucket we might render.
    const enrollmentRows = corporate.enabled
      ? await prisma.booking.groupBy({
          by: ['enrollmentPeriod'],
          where: {
            centerId: center.id,
            category: 'CORPORATE_BATCH',
            status: { not: 'CANCELLED' },
            enrollmentPeriod: { not: null },
          },
          _count: { _all: true },
        })
      : [];
    const countByPeriod = new Map<string, number>();
    for (const row of enrollmentRows) {
      if (row.enrollmentPeriod) countByPeriod.set(row.enrollmentPeriod, row._count._all);
    }
    const enrolledFor = (period: string): number =>
      overlappingPeriods(period).reduce((sum, p) => sum + (countByPeriod.get(p) ?? 0), 0);

    const monthOption = (period: string) => {
      const first = firstUpcomingSessionInPeriod(corporate, period, now);
      if (!first) return null;
      const enrolled = enrolledFor(period);
      return {
        period,
        label: formatPeriodLabel(period),
        fee: period.includes('-H') ? corporate.halfMonth.fee : corporate.monthlyFee,
        enrolled,
        capacity: corporate.maxCapacity,
        isFull: enrolled >= corporate.maxCapacity,
        startsOn: first.date,
        // The client echoes this back as the booking's single slot; the
        // server re-derives it anyway, so tampering is harmless.
        slot: {
          date: first.date,
          startTime: first.startTime.toISOString(),
          endTime: first.endTime.toISOString(),
        },
      };
    };

    const months = monthKeys
      .map((mk) => monthOption(mk))
      .filter((m): m is NonNullable<typeof m> => m !== null)
      .map((m) => ({
        ...m,
        halves: corporate.halfMonth.enabled
          ? (['H1', 'H2'] as const)
              .filter((h) => (h === 'H1' ? corporate.halfMonth.firstHalf : corporate.halfMonth.secondHalf))
              .map((h) => monthOption(`${m.period}-${h}`))
              .filter((h): h is NonNullable<typeof h> => h !== null)
          : [],
      }));

    // ─── Corporate batch: upcoming regular (per-session) dates ────────
    let corporateOccurrences = corporate.enabled
      ? listCorporateSessionDates(corporate, {
          fromDate: todayIST,
          horizonDays: SESSION_HORIZON_DAYS,
          now,
        })
      : [];

    // ─── Match simulation: upcoming occurrences ───────────────────────
    let simOccurrences = matchSim.enabled
      ? listMatchSimOccurrences(matchSim, {
          fromDate: todayIST,
          horizonDays: SESSION_HORIZON_DAYS,
          now,
        })
      : [];

    // ─── Admin blocks ─────────────────────────────────────────────────
    // Sessions taken off the schedule via /admin/slots (a block targeting
    // the category, or a catchall) must not render as bookable — without
    // this, the user only finds out via a 409 at submit. One query covers
    // the whole horizon; per-occurrence filtering mirrors the booking
    // route's evaluateBlockForBooking check exactly. Monthly enrollment
    // months are intentionally NOT block-filtered (an enrollment is a
    // month-long membership, not one session).
    if (corporateOccurrences.length > 0 || simOccurrences.length > 0) {
      const horizonEndDate = new Date(
        dateStringToUTC(todayIST).getTime() + SESSION_HORIZON_DAYS * 86_400_000,
      );
      const blockRows = await prisma.blockedSlot.findMany({
        where: {
          centerId: center.id,
          startDate: { lte: horizonEndDate },
          endDate: { gte: dateStringToUTC(todayIST) },
        },
        select: {
          id: true,
          startDate: true,
          endDate: true,
          startTime: true,
          endTime: true,
          recurringDays: true,
          reason: true,
          appliesTo: true,
          machineRowIds: true,
          resourceIds: true,
          categories: true,
          netCount: true,
          machineId: true,
          machineIds: true,
          machineType: true,
          pitchType: true,
        },
      });
      const isOccurrenceBlocked = (occ: SessionOccurrence, category: BookingCategory): boolean => {
        if (blockRows.length === 0) return false;
        const occDate = dateStringToUTC(occ.date);
        const dayCandidates = blockRows.filter(
          (b) => b.startDate <= occDate && b.endDate >= occDate,
        );
        if (dayCandidates.length === 0) return false;
        const active = filterBlocksForSlotSync(dayCandidates, {
          date: occDate,
          startTime: occ.startTime,
          endTime: occ.endTime,
        });
        return evaluateBlockForBooking(active, { category, resourceIds: [] }, 'ALL') !== null;
      };
      corporateOccurrences = corporateOccurrences.filter(
        (occ) => !isOccurrenceBlocked(occ, 'CORPORATE_BATCH'),
      );
      simOccurrences = simOccurrences.filter(
        (occ) => !isOccurrenceBlocked(occ, 'MATCH_SIMULATION'),
      );
    }

    // Seat counts for every occurrence in one query per category.
    const horizonEnd = new Date(
      dateStringToUTC(todayIST).getTime() + SESSION_HORIZON_DAYS * 86_400_000,
    );
    const seatRows =
      corporateOccurrences.length > 0 || simOccurrences.length > 0
        ? await prisma.booking.findMany({
            where: {
              centerId: center.id,
              category: { in: ['CORPORATE_BATCH', 'MATCH_SIMULATION'] },
              status: { not: 'CANCELLED' },
              date: { gte: dateStringToUTC(todayIST), lte: horizonEnd },
            },
            select: {
              category: true,
              corporateBatchMode: true,
              date: true,
              startTime: true,
            },
          })
        : [];

    const seatKey = (dateISO: string, startISO: string) => `${dateISO}|${startISO}`;
    const corporateRegularCounts = new Map<string, number>();
    const simSeatCounts = new Map<string, number>();
    for (const row of seatRows) {
      const key = seatKey(row.date.toISOString().slice(0, 10), row.startTime.toISOString());
      if (row.category === 'MATCH_SIMULATION') {
        simSeatCounts.set(key, (simSeatCounts.get(key) ?? 0) + 1);
      } else if (row.corporateBatchMode === 'REGULAR') {
        corporateRegularCounts.set(key, (corporateRegularCounts.get(key) ?? 0) + 1);
      }
    }

    // Members covering a given date = monthly + matching-half enrollments.
    const membersCoveringDate = (dateStr: string): number =>
      periodsCoveringDate(dateStr, corporate.halfMonth.splitDay)
        .reduce((sum, p) => sum + (countByPeriod.get(p) ?? 0), 0);

    const corporateSessions = corporateOccurrences.map((occ) => {
      const seats =
        membersCoveringDate(occ.date)
        + (corporateRegularCounts.get(seatKey(occ.date, occ.startTime.toISOString())) ?? 0);
      return {
        date: occ.date,
        dayLabel: DAY_LABELS[occ.dayOfWeek],
        startTime: occ.startTime.toISOString(),
        endTime: occ.endTime.toISOString(),
        fee: corporate.regularFee,
        seatsBooked: Math.min(seats, corporate.maxCapacity),
        capacity: corporate.maxCapacity,
        remaining: Math.max(0, corporate.maxCapacity - seats),
        isFull: seats >= corporate.maxCapacity,
      };
    });

    const simSessions = simOccurrences.map((occ) => {
      const booked = simSeatCounts.get(seatKey(occ.date, occ.startTime.toISOString())) ?? 0;
      return {
        sessionId: occ.session.id,
        label: occ.session.label,
        coachName: occ.session.coachName || null,
        date: occ.date,
        dayLabel: DAY_LABELS[occ.dayOfWeek],
        startTime: occ.startTime.toISOString(),
        endTime: occ.endTime.toISOString(),
        fee: occ.session.fee,
        booked: Math.min(booked, occ.session.capacity),
        capacity: occ.session.capacity,
        remaining: Math.max(0, occ.session.capacity - booked),
        isFull: booked >= occ.session.capacity,
      };
    });

    return NextResponse.json({
      centerId: center.id,
      corporateBatch: {
        enabled: corporate.enabled,
        days: corporate.days,
        startTime: corporate.startTime,
        endTime: corporate.endTime,
        coachName: corporate.coachName || null,
        monthlyFee: corporate.monthlyFee,
        regularFee: corporate.regularFee,
        maxCapacity: corporate.maxCapacity,
        halfMonth: corporate.halfMonth,
        months,
        sessions: corporateSessions,
      },
      matchSimulation: {
        enabled: matchSim.enabled,
        sessions: simSessions,
      },
    });
  } catch (error) {
    const { message, status } = sanitizeApiError(
      error,
      'match-practice.availability',
      'Could not load match practice sessions. Please try again.',
    );
    return NextResponse.json({ error: message }, { status });
  }
}
