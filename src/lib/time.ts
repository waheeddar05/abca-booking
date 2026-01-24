import { startOfDay, endOfDay, addMinutes, isAfter, isBefore, isEqual, format } from 'date-fns';

export const BUSINESS_START_HOUR = 9;
export const BUSINESS_END_HOUR = 18;
export const SLOT_DURATION_MINUTES = 30;

export function getServerTime() {
  return new Date();
}

export function generateSlotsForDate(date: Date) {
  const slots: { startTime: Date; endTime: Date }[] = [];
  const start = new Date(date);
  start.setHours(BUSINESS_START_HOUR, 0, 0, 0);

  const end = new Date(date);
  end.setHours(BUSINESS_END_HOUR, 0, 0, 0);

  let current = start;
  while (isBefore(current, end)) {
    const next = addMinutes(current, SLOT_DURATION_MINUTES);
    slots.push({
      startTime: new Date(current),
      endTime: new Date(next),
    });
    current = next;
  }

  return slots;
}

export function filterPastSlots(slots: { startTime: Date; endTime: Date }[]) {
  const now = getServerTime();
  return slots.filter(slot => isAfter(slot.startTime, now));
}
