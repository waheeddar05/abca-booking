export type BallType = 'TENNIS' | 'LEATHER' | 'MACHINE';

export interface SlotStatus {
  startTime: string; // ISO LocalDateTime
  endTime: string;
  status: 'Available' | 'Booked' | 'Unavailable';
}

export interface Booking {
  id?: number;
  startTime: string;
  endTime: string;
  ballType: BallType;
  playerName: string;
}

export interface BookingRequest {
  startTime: string;
  durationMinutes: number;
  ballType: BallType;
  playerName: string;
}

const API_BASE_URL = '/api';

export const bookingApi = {
  getSlots: async (date: string, ballType: BallType = 'TENNIS'): Promise<SlotStatus[]> => {
    const response = await fetch(`${API_BASE_URL}/slots/available?date=${date}&ballType=${ballType}`);
    if (!response.ok) throw new Error('Failed to fetch slots');
    return response.json();
  },

  createBooking: async (request: BookingRequest): Promise<Booking> => {
    const response = await fetch(`${API_BASE_URL}/slots/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: request.startTime.split('T')[0],
        startTime: request.startTime,
        endTime: new Date(new Date(request.startTime).getTime() + request.durationMinutes * 60000).toISOString(),
        ballType: request.ballType,
        playerName: request.playerName
      }),
    });
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || errorData.message || 'Failed to create booking');
    }
    return response.json();
  },

  getAllBookings: async (): Promise<Booking[]> => {
    const response = await fetch(`${API_BASE_URL}/bookings`);
    if (!response.ok) throw new Error('Failed to fetch bookings');
    return response.json();
  },

  cancelBooking: async (id: number | string): Promise<void> => {
    const response = await fetch(`${API_BASE_URL}/slots/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookingId: id }),
    });
    if (!response.ok) throw new Error('Failed to cancel booking');
  }
};
