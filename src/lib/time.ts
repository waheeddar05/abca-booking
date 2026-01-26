import { formatInTimeZone, toDate } from 'date-fns-tz';
import { addMinutes, isAfter, isBefore } from 'date-fns';

export const TIMEZONE = 'Asia/Kolkata';

// Default values if not in DB
export const DEFAULT_START_HOUR = 7;
export const DEFAULT_END_HOUR = 22;
export const DEFAULT_SLOT_DURATION = 30;

export function getISTTime() {
  return toDate(new Date(), { timeZone: TIMEZONE });
}

export function getServerTime() {
  return getISTTime();
}

export function generateSlotsForDate(date: Date, config?: { startHour?: number; endHour?: number; duration?: number }) {
  const startHour = config?.startHour ?? DEFAULT_START_HOUR;
  const endHour = config?.endHour ?? DEFAULT_END_HOUR;
  const duration = config?.duration ?? DEFAULT_SLOT_DURATION;

  const slots: { startTime: Date; endTime: Date }[] = [];
  
  // Create start time in IST
  const start = toDate(date, { timeZone: TIMEZONE });
  start.setHours(startHour, 0, 0, 0);

  // Create end time in IST
  const end = toDate(date, { timeZone: TIMEZONE });
  end.setHours(endHour, 0, 0, 0);

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
  const now = getISTTime();
  return slots.filter(slot => isAfter(slot.startTime, now));
}

export function formatIST(date: Date, formatStr: string) {
  return formatInTimeZone(date, TIMEZONE, formatStr);
}
