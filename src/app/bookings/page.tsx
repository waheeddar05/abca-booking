'use client';

import { useState, useEffect } from 'react';
import { format } from 'date-fns';

interface Booking {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  status: 'BOOKED' | 'CANCELLED' | 'DONE';
  playerName: string;
  ballType: string;
}

export default function BookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  useEffect(() => {
    fetchBookings();
  }, []);

  const fetchBookings = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/bookings');
      if (!res.ok) throw new Error('Failed to fetch bookings');
      const data = await res.json();
      setBookings(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async (bookingId: string) => {
    if (!confirm('Are you sure you want to cancel this booking?')) return;

    setCancellingId(bookingId);
    try {
      const res = await fetch('/api/slots/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Cancellation failed');
      }

      alert('Booking cancelled successfully');
      fetchBookings();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6">
      <h1 className="text-2xl sm:text-3xl font-bold mb-6 sm:mb-8">My Bookings</h1>

      {loading ? (
        <div className="text-center py-12">Loading bookings...</div>
      ) : error ? (
        <div className="text-red-600 text-center py-12">{error}</div>
      ) : bookings.length === 0 ? (
        <div className="text-center py-12 text-gray-500">You have no bookings yet.</div>
      ) : (
        <div className="space-y-4">
          {bookings.map((booking) => (
            <div key={booking.id} className="p-4 sm:p-6 bg-white border rounded-lg shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div className="w-full sm:w-auto">
                <div className="text-sm text-gray-500">{format(new Date(booking.date), 'EEEE, MMMM do, yyyy')}</div>
                <div className="text-lg sm:text-xl font-bold">
                  {new Date(booking.startTime).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })} - {new Date(booking.endTime).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}
                </div>
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <div className="text-gray-600">
                    <span className="font-semibold">Player:</span> {booking.playerName}
                  </div>
                  <div className="text-gray-600">
                    <span className="font-semibold">Ball Type:</span> {booking.ballType}
                  </div>
                </div>
                <div className={`mt-3 inline-block px-2 py-1 text-xs font-semibold rounded-full ${
                  booking.status === 'BOOKED' ? 'bg-green-100 text-green-800' : 
                  booking.status === 'DONE' ? 'bg-blue-100 text-blue-800' : 'bg-red-100 text-red-800'
                }`}>
                  {booking.status}
                </div>
              </div>
              {booking.status === 'BOOKED' && new Date(booking.startTime) > new Date() && (
                <button
                  disabled={!!cancellingId}
                  onClick={() => handleCancel(booking.id)}
                  className="w-full sm:w-auto px-4 py-2 border border-red-600 text-red-600 rounded-md hover:bg-red-50 disabled:opacity-50 transition-colors"
                >
                  {cancellingId === booking.id ? 'Cancelling...' : 'Cancel'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
