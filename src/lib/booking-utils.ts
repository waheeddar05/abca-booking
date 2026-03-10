/**
 * Shared utility for deriving booking display status.
 * IN_PROGRESS is not stored in the DB — it must be computed at render time.
 */

export type DisplayStatus = 'BOOKED' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';

interface BookingForStatus {
  status: string;
  startTime: string;
  endTime: string;
}

export function getDisplayStatus(booking: BookingForStatus): DisplayStatus {
  if (booking.status === 'CANCELLED') return 'CANCELLED';
  if (booking.status === 'DONE') return 'DONE';

  const now = Date.now();
  const start = new Date(booking.startTime).getTime();
  const end = new Date(booking.endTime).getTime();

  if (now >= start && now < end) return 'IN_PROGRESS';
  if (now >= end) return 'DONE';
  return 'BOOKED';
}
