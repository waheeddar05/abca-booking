import { formatInTimeZone } from 'date-fns-tz';
import { addMinutes, isAfter, isBefore, subMonths, startOfMonth, endOfMonth, format } from 'date-fns';

export const TIMEZONE = 'Asia/Kolkata';

// Default values if not in DB
export const DEFAULT_START_HOUR = 7;
export const DEFAULT_END_HOUR = 22;
export const DEFAULT_SLOT_DURATION = 30;

/**
 * Get the current IST date as a string (yyyy-MM-dd).
 */
export function getISTDateString(): string {
  return formatInTimeZone(new Date(), TIMEZONE, 'yyyy-MM-dd');
}

/**
 * Convert a date string to a UTC midnight Date for @db.Date comparisons.
 * PostgreSQL DATE columns are stored as UTC midnight dates by Prisma.
 */
export function dateStringToUTC(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00.000Z');
}

/**
 * Get today's IST date as a UTC midnight Date (for @db.Date column comparisons).
 */
export function getISTTodayUTC(): Date {
  return dateStringToUTC(getISTDateString());
}

/**
 * Get the IST "last month" start and end as UTC midnight Dates.
 */
export function getISTLastMonthRange(): { start: Date; end: Date } {
  const todayStr = getISTDateString();
  const todayDate = new Date(todayStr);
  const lastMonth = subMonths(todayDate, 1);
  const monthStart = startOfMonth(lastMonth);
  const monthEnd = endOfMonth(lastMonth);
  return {
    start: dateStringToUTC(format(monthStart, 'yyyy-MM-dd')),
    end: dateStringToUTC(format(monthEnd, 'yyyy-MM-dd')),
  };
}

/**
 * Get current time as IST-aware Date.
 */
export function getISTTime() {
  const istStr = formatInTimeZone(new Date(), TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");
  return new Date(istStr);
}

export function getServerTime() {
  return getISTTime();
}

export function generateSlotsForDate(date: Date, config?: { startHour?: number; endHour?: number; duration?: number }) {
  const startHour = config?.startHour ?? DEFAULT_START_HOUR;
  const endHour = config?.endHour ?? DEFAULT_END_HOUR;
  const duration = config?.duration ?? DEFAULT_SLOT_DURATION;

  const slots: { startTime: Date; endTime: Date }[] = [];

  // Get the date string and create IST-aware times using +05:30 offset
  const dateStr = formatInTimeZone(date, 'UTC', 'yyyy-MM-dd');
  const startStr = `${dateStr}T${String(startHour).padStart(2, '0')}:00:00+05:30`;
  const endStr = `${dateStr}T${String(endHour).padStart(2, '0')}:00:00+05:30`;
  const start = new Date(startStr);
  const end = new Date(endStr);

  let current = start;
  while (isBefore(current, end)) {
    const next = addMinutes(current, duration);
    slots.push({
      startTime: new Date(current),
      endTime: new Date(next),
    });
    current = next;
  }

  return slots;
}

export function filterPastSlots(slots: { startTime: Date; endTime: Date }[]) {
  const now = new Date();
  return slots.filter(slot => isAfter(slot.startTime, now));
}

export function formatIST(date: Date, formatStr: string) {
  return formatInTimeZone(date, TIMEZONE, formatStr);
}
