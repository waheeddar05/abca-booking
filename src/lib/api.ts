export type BallType = 'TENNIS' | 'LEATHER' | 'MACHINE';
export type MachineId = 'GRAVITY' | 'YANTRA' | 'LEVERAGE_INDOOR' | 'LEVERAGE_OUTDOOR';

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
  machineId?: MachineId;
  playerName: string;
}

export interface BookingRequest {
  startTime: string;
  durationMinutes: number;
  ballType: BallType;
  machineId?: MachineId;
  playerName: string;
}

const API_BASE_URL = '/api';

export const bookingApi = {
  getSlots: async (date: string, ballType: BallType = 'TENNIS', machineId?: MachineId): Promise<SlotStatus[]> => {
    let url = `${API_BASE_URL}/slots/available?date=${date}&ballType=${ballType}`;
    if (machineId) url += `&machineId=${machineId}`;
    const response = await fetch(url);
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
        ...(request.machineId ? { machineId: request.machineId } : {}),
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
