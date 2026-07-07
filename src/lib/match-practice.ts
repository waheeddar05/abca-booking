/**
 * Match Practice — Corporate Batch enrollments + Match Simulation sessions.
 *
 * Both subcategories are SEAT-based, not resource-based: a session has an
 * admin-configured capacity and every non-cancelled Booking row of that
 * category counts one seat. No machine, ball type, pitch type, or operator
 * is involved anywhere in these flows.
 *
 * ### Corporate Batch  (Booking.category = CORPORATE_BATCH)
 *
 * Config lives in the `CORPORATE_BATCH_CONFIG` center policy — the same
 * key the resource engine already reads for its indoor-net hold (see
 * resource-booking.ts). This module reads the FULL shape; the engine only
 * consumes the enabled/days/startTime/endTime/netsConsumed subset, so
 * old policy rows keep working (missing fields fall back to defaults).
 *
 * Three purchase modes (Booking.corporateBatchMode):
 *   MONTHLY     one row per user per month; enrollmentPeriod "YYYY-MM".
 *   HALF_MONTH  one row per user per half-month; "YYYY-MM-H1" / "-H2".
 *               Only offered when config.halfMonth.enabled.
 *   REGULAR     one row per user per attended session date; counted by
 *               (date, startTime), enrollmentPeriod stays null.
 *
 * Seats for a given session date = members whose enrollment period covers
 * the date (full month, or the matching half) + regular (per-session)
 * rows on that date.
 *
 * ### Match Simulation  (Booking.category = MATCH_SIMULATION)
 *
 * Config lives in the new `MATCH_SIMULATION_CONFIG` center policy: a list
 * of sessions, each with its own weekdays, time window, capacity, fee and
 * optional coach. Multiple sessions per day are supported (e.g. a morning
 * and an evening batch). Seats are counted per (date, startTime).
 */

import { prisma } from '@/lib/prisma';
import { getCenterOnlyPolicyJson } from '@/lib/policy';
import { dateStringToUTC, getISTDateString } from '@/lib/time';
import { BookingResourceError } from '@/lib/resource-booking';

// ─── Corporate Batch config ──────────────────────────────────────────

export interface HalfMonthConfig {
  enabled: boolean;
  /** ₹ fee for a half-month enrollment. */
  fee: number;
  /** Whether the first half (1 → splitDay) can be purchased. */
  firstHalf: boolean;
  /** Whether the second half (splitDay+1 → month end) can be purchased. */
  secondHalf: boolean;
  /** Last day-of-month included in the first half. 15 = calendar halves;
   *  admins can shift it for a custom split. */
  splitDay: number;
}

export interface CorporateBatchSettings {
  enabled: boolean;
  /** IST day-of-week 0..6 (0 = Sunday). */
  days: number[];
  startTime: string; // "HH:MM" IST
  endTime: string;   // "HH:MM" IST
  /** Indoor nets the batch physically holds during its window — consumed
   *  by the resource engine's virtual reservation, not by this module. */
  netsConsumed: number;
  coachName: string;
  monthlyFee: number;
  /** ₹ fee for a single Regular (per-session) booking. */
  regularFee: number;
  /** Seats per batch — monthly members and regular attendees share it. */
  maxCapacity: number;
  halfMonth: HalfMonthConfig;
}

export const DEFAULT_CORPORATE_BATCH_SETTINGS: CorporateBatchSettings = {
  // Off by default — a corporate batch is a center-specific arrangement.
  // Enabling it (and editing everything below) happens in Admin →
  // Settings → Match Practice.
  enabled: false,
  days: [1, 3, 5], // Mon / Wed / Fri
  startTime: '07:00',
  endTime: '09:00',
  netsConsumed: 2,
  coachName: 'Govind Lashkare',
  monthlyFee: 2000,
  regularFee: 200,
  maxCapacity: 25,
  halfMonth: {
    enabled: false,
    fee: 1000,
    firstHalf: true,
    secondHalf: true,
    splitDay: 15,
  },
};

/** Merge a (possibly legacy / partial) policy JSON with the defaults so
 *  old CORPORATE_BATCH_CONFIG rows — which only carried the resource-hold
 *  fields — gain the new enrollment knobs without breaking. */
export function normalizeCorporateBatchSettings(
  raw: unknown,
): CorporateBatchSettings {
  const d = DEFAULT_CORPORATE_BATCH_SETTINGS;
  if (!raw || typeof raw !== 'object') return { ...d, halfMonth: { ...d.halfMonth } };
  const r = raw as Partial<CorporateBatchSettings> & { halfMonth?: Partial<HalfMonthConfig> };
  const num = (v: unknown, fb: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fb;
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : d.enabled,
    days: Array.isArray(r.days)
      ? r.days.filter((x): x is number => typeof x === 'number' && x >= 0 && x <= 6)
      : d.days,
    startTime: typeof r.startTime === 'string' && r.startTime ? r.startTime : d.startTime,
    endTime: typeof r.endTime === 'string' && r.endTime ? r.endTime : d.endTime,
    netsConsumed: num(r.netsConsumed, d.netsConsumed),
    coachName: typeof r.coachName === 'string' ? r.coachName : d.coachName,
    monthlyFee: num(r.monthlyFee, d.monthlyFee),
    // Accept the legacy `adhocFee` key so configs saved before the
    // Ad-hoc → Regular rename keep their fee.
    regularFee: num(r.regularFee ?? (r as { adhocFee?: number }).adhocFee, d.regularFee),
    maxCapacity: Math.max(1, num(r.maxCapacity, d.maxCapacity)),
    halfMonth: {
      enabled: typeof r.halfMonth?.enabled === 'boolean' ? r.halfMonth.enabled : d.halfMonth.enabled,
      fee: num(r.halfMonth?.fee, d.halfMonth.fee),
      firstHalf: typeof r.halfMonth?.firstHalf === 'boolean' ? r.halfMonth.firstHalf : d.halfMonth.firstHalf,
      secondHalf: typeof r.halfMonth?.secondHalf === 'boolean' ? r.halfMonth.secondHalf : d.halfMonth.secondHalf,
      splitDay: Math.min(27, Math.max(1, num(r.halfMonth?.splitDay, d.halfMonth.splitDay))),
    },
  };
}

export async function getCorporateBatchSettings(centerId: string): Promise<CorporateBatchSettings> {
  const raw = await getCenterOnlyPolicyJson<unknown>('CORPORATE_BATCH_CONFIG', centerId, null);
  return normalizeCorporateBatchSettings(raw);
}

// ─── Match Simulation config ─────────────────────────────────────────

export interface MatchSimulationSession {
  /** Stable id generated by the admin editor — bookings are still counted
   *  by (date, startTime) so renaming/re-timing a session never orphans
   *  existing rows. */
  id: string;
  label: string;
  days: number[]; // IST 0..6
  startTime: string; // "HH:MM" IST
  endTime: string;
  capacity: number;
  fee: number;
  coachName: string;
  enabled: boolean;
}

export interface MatchSimulationSettings {
  enabled: boolean;
  sessions: MatchSimulationSession[];
}

export const DEFAULT_MATCH_SIMULATION_SETTINGS: MatchSimulationSettings = {
  enabled: false,
  sessions: [
    {
      id: 'ms-default',
      label: 'Morning Batch',
      days: [0, 2, 4, 5, 6], // Sun, Tue, Thu, Fri, Sat
      startTime: '07:00',
      endTime: '09:00',
      capacity: 10,
      fee: 200,
      coachName: '',
      enabled: true,
    },
  ],
};

export function normalizeMatchSimulationSettings(raw: unknown): MatchSimulationSettings {
  const d = DEFAULT_MATCH_SIMULATION_SETTINGS;
  if (!raw || typeof raw !== 'object') {
    return { enabled: d.enabled, sessions: d.sessions.map((s) => ({ ...s })) };
  }
  const r = raw as Partial<MatchSimulationSettings>;
  const rawSessions = Array.isArray(r.sessions)
    ? (r.sessions as Array<Partial<MatchSimulationSession> | null | undefined>)
    : null;
  const sessions: MatchSimulationSession[] = rawSessions
    ? rawSessions
        .filter((s): s is Partial<MatchSimulationSession> => !!s && typeof s === 'object')
        .map((s, i) => ({
          id: typeof s.id === 'string' && s.id ? s.id : `ms-${i}`,
          label: typeof s.label === 'string' ? s.label : '',
          days: Array.isArray(s.days)
            ? s.days.filter((x): x is number => typeof x === 'number' && x >= 0 && x <= 6)
            : [],
          startTime: typeof s.startTime === 'string' && s.startTime ? s.startTime : '07:00',
          endTime: typeof s.endTime === 'string' && s.endTime ? s.endTime : '09:00',
          capacity: Math.max(1, typeof s.capacity === 'number' && Number.isFinite(s.capacity) ? Math.floor(s.capacity) : 10),
          fee: typeof s.fee === 'number' && Number.isFinite(s.fee) && s.fee >= 0 ? s.fee : 200,
          coachName: typeof s.coachName === 'string' ? s.coachName : '',
          enabled: typeof s.enabled === 'boolean' ? s.enabled : true,
        }))
    : d.sessions.map((s) => ({ ...s }));
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : d.enabled,
    sessions,
  };
}

export async function getMatchSimulationSettings(centerId: string): Promise<MatchSimulationSettings> {
  const raw = await getCenterOnlyPolicyJson<unknown>('MATCH_SIMULATION_CONFIG', centerId, null);
  return normalizeMatchSimulationSettings(raw);
}

// ─── Period + time helpers ───────────────────────────────────────────

export type CorporateHalf = 'H1' | 'H2';

export interface ParsedPeriod {
  year: number;
  month: number; // 1-12
  half: CorporateHalf | null;
}

/** "2026-07" → {2026, 7, null}; "2026-07-H2" → {2026, 7, 'H2'}; else null. */
export function parseEnrollmentPeriod(period: string): ParsedPeriod | null {
  const m = /^(\d{4})-(\d{2})(?:-(H1|H2))?$/.exec(period);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year, month, half: (m[3] as CorporateHalf | undefined) ?? null };
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "2026-07" → "July 2026"; "2026-07-H1" → "July 2026 · First Half". */
export function formatPeriodLabel(period: string): string {
  const p = parseEnrollmentPeriod(period);
  if (!p) return period;
  const base = `${MONTH_NAMES[p.month - 1]} ${p.year}`;
  if (p.half === 'H1') return `${base} · First Half`;
  if (p.half === 'H2') return `${base} · Second Half`;
  return base;
}

/** Build the UTC instant for an IST wall-clock time on an IST calendar day. */
export function istDateTimeToUTC(dateStr: string, hhmm: string): Date {
  return new Date(`${dateStr}T${hhmm}:00+05:30`);
}

/** Day-of-week (0=Sun..6=Sat) of an IST calendar date string. */
export function dayOfWeekOf(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

/** All enrollment periods that OVERLAP the given one. A monthly member
 *  and an H1 member share seats during the first half, so capacity and
 *  duplicate checks must consider all overlapping period strings. */
export function overlappingPeriods(period: string): string[] {
  const p = parseEnrollmentPeriod(period);
  if (!p) return [period];
  const monthKey = `${p.year}-${pad2(p.month)}`;
  if (p.half) return [monthKey, `${monthKey}-${p.half}`];
  return [monthKey, `${monthKey}-H1`, `${monthKey}-H2`];
}

/** Periods covering a specific session DATE: the full month plus the
 *  half the date falls in. Used to count members for a session. */
export function periodsCoveringDate(dateStr: string, splitDay: number): string[] {
  const monthKey = dateStr.slice(0, 7);
  const day = Number(dateStr.slice(8, 10));
  const half: CorporateHalf = day <= splitDay ? 'H1' : 'H2';
  return [monthKey, `${monthKey}-${half}`];
}

// ─── Session occurrence generation ───────────────────────────────────

export interface SessionOccurrence {
  /** IST calendar day, YYYY-MM-DD. */
  date: string;
  dayOfWeek: number;
  startTime: Date; // UTC instant
  endTime: Date;
}

/**
 * Upcoming corporate-batch session dates from `fromDate` (inclusive, IST
 * "YYYY-MM-DD") for `horizonDays` days, filtered to occurrences that
 * haven't started yet relative to `now`.
 */
export function listCorporateSessionDates(
  settings: Pick<CorporateBatchSettings, 'days' | 'startTime' | 'endTime'>,
  opts: { fromDate: string; horizonDays: number; now: Date },
): SessionOccurrence[] {
  if (settings.days.length === 0) return [];
  const out: SessionOccurrence[] = [];
  const start = dateStringToUTC(opts.fromDate);
  for (let i = 0; i < opts.horizonDays; i++) {
    const d = new Date(start.getTime() + i * 86_400_000);
    const dateStr = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    if (!settings.days.includes(dow)) continue;
    const startTime = istDateTimeToUTC(dateStr, settings.startTime);
    if (startTime <= opts.now) continue;
    out.push({
      date: dateStr,
      dayOfWeek: dow,
      startTime,
      endTime: istDateTimeToUTC(dateStr, settings.endTime),
    });
  }
  return out;
}

/**
 * First not-yet-started session occurrence inside an enrollment period.
 * Used as the Booking row's (date, startTime, endTime) for MONTHLY /
 * HALF_MONTH enrollments — "your membership starts from this session".
 * Returns null when the period has no remaining sessions (fully in the
 * past, or the configured days never occur in the half).
 */
export function firstUpcomingSessionInPeriod(
  settings: Pick<CorporateBatchSettings, 'days' | 'startTime' | 'endTime' | 'halfMonth'>,
  period: string,
  now: Date,
): SessionOccurrence | null {
  const p = parseEnrollmentPeriod(period);
  if (!p || settings.days.length === 0) return null;
  const total = daysInMonth(p.year, p.month);
  const split = settings.halfMonth?.splitDay ?? 15;
  const fromDay = p.half === 'H2' ? split + 1 : 1;
  const toDay = p.half === 'H1' ? split : total;
  for (let day = fromDay; day <= toDay; day++) {
    const dateStr = `${p.year}-${pad2(p.month)}-${pad2(day)}`;
    if (!settings.days.includes(dayOfWeekOf(dateStr))) continue;
    const startTime = istDateTimeToUTC(dateStr, settings.startTime);
    if (startTime <= now) continue;
    return {
      date: dateStr,
      dayOfWeek: dayOfWeekOf(dateStr),
      startTime,
      endTime: istDateTimeToUTC(dateStr, settings.endTime),
    };
  }
  return null;
}

/** Month keys ("YYYY-MM") for the current IST month plus the next
 *  `count - 1`. The caller drops months with no remaining sessions. */
export function listMonthKeys(count: number, todayIST: string): string[] {
  const year = Number(todayIST.slice(0, 4));
  const month = Number(todayIST.slice(5, 7));
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const m = month - 1 + i;
    out.push(`${year + Math.floor(m / 12)}-${pad2((m % 12) + 1)}`);
  }
  return out;
}

export interface MatchSimOccurrence extends SessionOccurrence {
  session: MatchSimulationSession;
}

/** Upcoming match-simulation occurrences across every enabled session,
 *  sorted by start time. Multiple sessions on the same day each yield
 *  their own occurrence. */
export function listMatchSimOccurrences(
  settings: MatchSimulationSettings,
  opts: { fromDate: string; horizonDays: number; now: Date },
): MatchSimOccurrence[] {
  const out: MatchSimOccurrence[] = [];
  const start = dateStringToUTC(opts.fromDate);
  const enabledSessions = settings.sessions.filter((s) => s.enabled && s.days.length > 0);
  for (let i = 0; i < opts.horizonDays; i++) {
    const d = new Date(start.getTime() + i * 86_400_000);
    const dateStr = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    for (const session of enabledSessions) {
      if (!session.days.includes(dow)) continue;
      const startTime = istDateTimeToUTC(dateStr, session.startTime);
      if (startTime <= opts.now) continue;
      out.push({
        date: dateStr,
        dayOfWeek: dow,
        startTime,
        endTime: istDateTimeToUTC(dateStr, session.endTime),
        session,
      });
    }
  }
  out.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  return out;
}

// ─── Seat counting ───────────────────────────────────────────────────

/** Narrow client type so the same helpers run against `prisma` or a
 *  transaction client. */
type BookingCountClient = {
  booking: {
    count: typeof prisma.booking.count;
  };
};

/** Members enrolled for periods overlapping `period` (full month counts
 *  H1 + H2 + monthly; a half counts monthly + that half). */
export async function countEnrollments(
  client: BookingCountClient,
  centerId: string,
  period: string,
): Promise<number> {
  return client.booking.count({
    where: {
      centerId,
      category: 'CORPORATE_BATCH',
      status: { not: 'CANCELLED' },
      enrollmentPeriod: { in: overlappingPeriods(period) },
    },
  });
}

/** Seats taken for one corporate-batch session date = members whose
 *  period covers the date + regular (per-session) rows for that
 *  exact session. */
export async function countCorporateSessionSeats(
  client: BookingCountClient,
  centerId: string,
  dateStr: string,
  startTime: Date,
  splitDay: number,
): Promise<number> {
  const [members, adhoc] = await Promise.all([
    client.booking.count({
      where: {
        centerId,
        category: 'CORPORATE_BATCH',
        status: { not: 'CANCELLED' },
        enrollmentPeriod: { in: periodsCoveringDate(dateStr, splitDay) },
      },
    }),
    client.booking.count({
      where: {
        centerId,
        category: 'CORPORATE_BATCH',
        corporateBatchMode: 'REGULAR',
        status: { not: 'CANCELLED' },
        date: dateStringToUTC(dateStr),
        startTime,
      },
    }),
  ]);
  return members + adhoc;
}

export async function countMatchSimSeats(
  client: BookingCountClient,
  centerId: string,
  dateStr: string,
  startTime: Date,
): Promise<number> {
  return client.booking.count({
    where: {
      centerId,
      category: 'MATCH_SIMULATION',
      status: { not: 'CANCELLED' },
      date: dateStringToUTC(dateStr),
      startTime,
    },
  });
}

// ─── Booking-plan resolution (server-side source of truth) ───────────

export type MatchPracticeCategory = 'CORPORATE_BATCH' | 'MATCH_SIMULATION';
export type CorporateMode = 'MONTHLY' | 'HALF_MONTH' | 'REGULAR';

export interface MatchPracticePlan {
  category: MatchPracticeCategory;
  /** Set for CORPORATE_BATCH; null for MATCH_SIMULATION. */
  mode: CorporateMode | null;
  /** Set for MONTHLY / HALF_MONTH; null otherwise. */
  enrollmentPeriod: string | null;
  dateStr: string;
  date: Date;      // UTC midnight of the IST day (@db.Date convention)
  startTime: Date;
  endTime: Date;
  fee: number;
  capacity: number;
  /** Human-readable session label for error messages / confirmations. */
  label: string;
  coachName: string | null;
  /** Corporate only — half-month boundary used for seat counting. */
  splitDay: number;
}

export interface MatchPracticeBookingRequest {
  category: MatchPracticeCategory;
  corporateMode?: CorporateMode | null;
  enrollmentPeriod?: string | null;
  slots: Array<{ date: string; startTime: string; endTime: string }>;
}

/**
 * Turn a booking request into fully-derived plans. Everything the client
 * sent is re-validated against the center's config:
 *   - MONTHLY / HALF_MONTH ignore client slots entirely — the session
 *     window is derived from the enrollment period + configured days.
 *   - REGULAR / MATCH_SIMULATION slots must land exactly on a configured
 *     session (weekday + start/end time) and start in the future.
 * Throws BookingResourceError with a user-facing message on any mismatch.
 */
export async function resolveMatchPracticePlans(
  centerId: string,
  body: MatchPracticeBookingRequest,
  nowOverride?: Date,
): Promise<MatchPracticePlan[]> {
  const now = nowOverride ?? new Date();
  const todayIST = getISTDateString();

  if (body.category === 'CORPORATE_BATCH') {
    const settings = await getCorporateBatchSettings(centerId);
    if (!settings.enabled) {
      throw new BookingResourceError('Corporate batch is not available at this center', 400);
    }
    const mode = body.corporateMode;
    if (!mode) {
      throw new BookingResourceError('Corporate batch booking mode is required', 400);
    }

    if (mode === 'MONTHLY' || mode === 'HALF_MONTH') {
      const period = body.enrollmentPeriod ?? '';
      const parsed = parseEnrollmentPeriod(period);
      if (!parsed || (mode === 'MONTHLY') !== (parsed.half === null)) {
        throw new BookingResourceError('Invalid enrollment period', 400);
      }
      if (mode === 'HALF_MONTH') {
        if (!settings.halfMonth.enabled) {
          throw new BookingResourceError('Half-month enrollment is not enabled at this center', 400);
        }
        if (parsed.half === 'H1' && !settings.halfMonth.firstHalf) {
          throw new BookingResourceError('First-half enrollment is not available', 400);
        }
        if (parsed.half === 'H2' && !settings.halfMonth.secondHalf) {
          throw new BookingResourceError('Second-half enrollment is not available', 400);
        }
      }
      // Only current or near-future months are enrollable.
      const monthKey = period.slice(0, 7);
      const allowedMonths = listMonthKeys(12, todayIST);
      if (!allowedMonths.includes(monthKey)) {
        throw new BookingResourceError('Enrollment is only open for the current and upcoming months', 400);
      }
      const first = firstUpcomingSessionInPeriod(settings, period, now);
      if (!first) {
        throw new BookingResourceError(
          `No upcoming corporate batch sessions in ${formatPeriodLabel(period)}`,
          400,
        );
      }
      return [{
        category: 'CORPORATE_BATCH',
        mode,
        enrollmentPeriod: period,
        dateStr: first.date,
        date: dateStringToUTC(first.date),
        startTime: first.startTime,
        endTime: first.endTime,
        fee: mode === 'MONTHLY' ? settings.monthlyFee : settings.halfMonth.fee,
        capacity: settings.maxCapacity,
        label: formatPeriodLabel(period),
        coachName: settings.coachName || null,
        splitDay: settings.halfMonth.splitDay,
      }];
    }

    // REGULAR — every requested slot must be a real upcoming batch session.
    if (body.slots.length === 0) {
      throw new BookingResourceError('Select at least one session', 400);
    }
    return body.slots.map((s) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s.date)) {
        throw new BookingResourceError('Invalid session date', 400);
      }
      if (!settings.days.includes(dayOfWeekOf(s.date))) {
        throw new BookingResourceError(
          `There is no corporate batch session on ${s.date}`,
          400,
        );
      }
      // The window always comes from config — client times are ignored.
      const startTime = istDateTimeToUTC(s.date, settings.startTime);
      const endTime = istDateTimeToUTC(s.date, settings.endTime);
      if (startTime <= now) {
        throw new BookingResourceError('This session has already started', 400);
      }
      return {
        category: 'CORPORATE_BATCH' as const,
        mode: 'REGULAR' as const,
        enrollmentPeriod: null,
        dateStr: s.date,
        date: dateStringToUTC(s.date),
        startTime,
        endTime,
        fee: settings.regularFee,
        capacity: settings.maxCapacity,
        label: `${s.date} ${settings.startTime}–${settings.endTime}`,
        coachName: settings.coachName || null,
        splitDay: settings.halfMonth.splitDay,
      };
    });
  }

  // MATCH_SIMULATION
  const settings = await getMatchSimulationSettings(centerId);
  if (!settings.enabled) {
    throw new BookingResourceError('Match simulation is not available at this center', 400);
  }
  if (body.slots.length === 0) {
    throw new BookingResourceError('Select at least one session', 400);
  }
  const enabledSessions = settings.sessions.filter((s) => s.enabled);
  return body.slots.map((slot) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(slot.date)) {
      throw new BookingResourceError('Invalid session date', 400);
    }
    const dow = dayOfWeekOf(slot.date);
    const requestedStart = new Date(slot.startTime);
    // Match the configured session by weekday + exact start instant. The
    // client echoes the times it got from /api/match-practice/availability,
    // but only config-derived values are trusted.
    const session = enabledSessions.find(
      (s) =>
        s.days.includes(dow)
        && istDateTimeToUTC(slot.date, s.startTime).getTime() === requestedStart.getTime(),
    );
    if (!session) {
      throw new BookingResourceError(
        `No match simulation session matches ${slot.date} at the selected time`,
        400,
      );
    }
    const startTime = istDateTimeToUTC(slot.date, session.startTime);
    if (startTime <= now) {
      throw new BookingResourceError('This session has already started', 400);
    }
    return {
      category: 'MATCH_SIMULATION' as const,
      mode: null,
      enrollmentPeriod: null,
      dateStr: slot.date,
      date: dateStringToUTC(slot.date),
      startTime,
      endTime: istDateTimeToUTC(slot.date, session.endTime),
      fee: session.fee,
      capacity: session.capacity,
      label: session.label
        ? `${session.label} · ${slot.date}`
        : `${slot.date} ${session.startTime}–${session.endTime}`,
      coachName: session.coachName || null,
      splitDay: 15,
    };
  });
}

// ─── In-transaction seat + duplicate guards ──────────────────────────

type BookingTxClient = {
  booking: {
    count: typeof prisma.booking.count;
    findFirst: typeof prisma.booking.findFirst;
  };
};

/**
 * Enforce capacity + one-seat-per-user inside the booking transaction.
 * Runs under Serializable isolation via the caller, so two concurrent
 * submits for the last seat conflict and one retries into a clean
 * "session full" rejection.
 */
export async function assertMatchPracticeSeat(
  tx: BookingTxClient,
  centerId: string,
  userId: string,
  plan: MatchPracticePlan,
): Promise<void> {
  if (plan.category === 'CORPORATE_BATCH' && plan.enrollmentPeriod) {
    // Duplicate: any enrollment overlapping this period.
    const dup = await tx.booking.findFirst({
      where: {
        centerId,
        userId,
        category: 'CORPORATE_BATCH',
        status: { not: 'CANCELLED' },
        enrollmentPeriod: { in: overlappingPeriods(plan.enrollmentPeriod) },
      },
      select: { id: true },
    });
    if (dup) {
      throw new BookingResourceError(
        `You are already enrolled for ${formatPeriodLabel(plan.enrollmentPeriod)}`,
        409,
      );
    }
    const enrolled = await countEnrollments(tx, centerId, plan.enrollmentPeriod);
    if (enrolled >= plan.capacity) {
      throw new BookingResourceError(
        `${formatPeriodLabel(plan.enrollmentPeriod)} batch is full (${enrolled} of ${plan.capacity} enrolled)`,
        409,
      );
    }
    return;
  }

  if (plan.category === 'CORPORATE_BATCH') {
    // REGULAR — duplicate: same user, same session; or a membership that
    // already covers this date (no point paying twice).
    const dupAdhoc = await tx.booking.findFirst({
      where: {
        centerId,
        userId,
        category: 'CORPORATE_BATCH',
        status: { not: 'CANCELLED' },
        OR: [
          { date: plan.date, startTime: plan.startTime },
          { enrollmentPeriod: { in: periodsCoveringDate(plan.dateStr, plan.splitDay) } },
        ],
      },
      select: { id: true, enrollmentPeriod: true },
    });
    if (dupAdhoc) {
      throw new BookingResourceError(
        dupAdhoc.enrollmentPeriod
          ? 'Your monthly enrollment already covers this session'
          : 'You already have a seat in this session',
        409,
      );
    }
    const seats = await countCorporateSessionSeats(
      tx, centerId, plan.dateStr, plan.startTime, plan.splitDay,
    );
    if (seats >= plan.capacity) {
      throw new BookingResourceError(
        `This session is full (${seats} of ${plan.capacity} seats booked)`,
        409,
      );
    }
    return;
  }

  // MATCH_SIMULATION
  const dup = await tx.booking.findFirst({
    where: {
      centerId,
      userId,
      category: 'MATCH_SIMULATION',
      status: { not: 'CANCELLED' },
      date: plan.date,
      startTime: plan.startTime,
    },
    select: { id: true },
  });
  if (dup) {
    throw new BookingResourceError('You already have a seat in this session', 409);
  }
  const seats = await countMatchSimSeats(tx, centerId, plan.dateStr, plan.startTime);
  if (seats >= plan.capacity) {
    throw new BookingResourceError(
      `This session is full (${seats} of ${plan.capacity} slots booked)`,
      409,
    );
  }
}

/** Route-level gate: is this booking category handled by this module? */
export function isMatchPracticeCategory(category: string): category is MatchPracticeCategory {
  return category === 'CORPORATE_BATCH' || category === 'MATCH_SIMULATION';
}
