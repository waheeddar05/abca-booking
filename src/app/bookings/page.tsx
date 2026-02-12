'use client';

import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { ClipboardList, Loader2, X, Calendar, Clock, IndianRupee } from 'lucide-react';

interface Booking {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  status: 'BOOKED' | 'CANCELLED' | 'DONE';
  playerName: string;
  ballType: string;
  pitchType: string | null;
  price: number | null;
  originalPrice: number | null;
  discountAmount: number | null;
  extraCharge: number | null;
  operationMode: 'WITH_OPERATOR' | 'SELF_OPERATE';
}

export default function BookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
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

  const statusConfig = {
    BOOKED: { label: 'Upcoming', bg: 'bg-green-50', text: 'text-green-700', dot: 'bg-green-500' },
    DONE: { label: 'Completed', bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500' },
    CANCELLED: { label: 'Cancelled', bg: 'bg-gray-50', text: 'text-gray-500', dot: 'bg-gray-400' },
  };

  const ballTypeConfig: Record<string, { color: string; label: string }> = {
    TENNIS: { color: 'bg-green-500', label: 'Tennis' },
    LEATHER: { color: 'bg-red-500', label: 'Leather' },
    MACHINE: { color: 'bg-blue-500', label: 'Machine' },
  };

  const getDisplayStatus = (booking: Booking): Booking['status'] => {
    if (booking.status !== 'BOOKED') return booking.status;
    return new Date(booking.endTime).getTime() <= Date.now() ? 'DONE' : 'BOOKED';
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-5">
      {/* Page Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <ClipboardList className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">My Bookings</h1>
          <p className="text-xs text-gray-400">{bookings.length} total session{bookings.length !== 1 ? 's' : ''}</p>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <Loader2 className="w-6 h-6 animate-spin mb-2" />
          <span className="text-sm">Loading bookings...</span>
        </div>
      ) : error ? (
        <div className="text-center py-20">
          <p className="text-red-500 text-sm">{error}</p>
          <button onClick={fetchBookings} className="mt-3 text-sm text-primary font-medium cursor-pointer">Try again</button>
        </div>
      ) : bookings.length === 0 ? (
        <div className="text-center py-20">
          <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-4">
            <ClipboardList className="w-6 h-6 text-gray-400" />
          </div>
          <p className="text-sm font-medium text-gray-500 mb-1">No bookings yet</p>
          <p className="text-xs text-gray-400">Book your first practice session to get started</p>
        </div>
      ) : (
        <div className="space-y-3">
          {bookings.map((booking) => {
            const displayStatus = getDisplayStatus(booking);
            const status = statusConfig[displayStatus];
            const ballInfo = ballTypeConfig[booking.ballType] || { color: 'bg-gray-400', label: booking.ballType };
            const canCancel = booking.status === 'BOOKED' && new Date(booking.startTime) > new Date();
            const hasDiscount = booking.discountAmount && booking.discountAmount > 0;

            return (
              <div key={booking.id} className="bg-white rounded-xl border border-gray-100 p-4 transition-all hover:shadow-sm">
                {/* Top Row: Status + Cancel */}
                <div className="flex items-center justify-between mb-3">
                  <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ${status.bg} ${status.text}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`}></span>
                    {status.label}
                  </div>
                  {canCancel && (
                    <button
                      disabled={!!cancellingId}
                      onClick={() => handleCancel(booking.id)}
                      className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                      {cancellingId === booking.id ? 'Cancelling...' : 'Cancel'}
                    </button>
                  )}
                </div>

                {/* Time */}
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="w-4 h-4 text-gray-400" />
                  <span className="text-base font-bold text-gray-900">
                    {new Date(booking.startTime).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}
                    {' - '}
                    {new Date(booking.endTime).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>

                {/* Date */}
                <div className="flex items-center gap-2 mb-3">
                  <Calendar className="w-4 h-4 text-gray-400" />
                  <span className="text-sm text-gray-500">
                    {format(new Date(booking.date), 'EEEE, MMM d, yyyy')}
                  </span>
                </div>

                {/* Meta Row */}
                <div className="flex items-center justify-between pt-3 border-t border-gray-50">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5 text-xs text-gray-500">
                      <span className={`w-2 h-2 rounded-full ${ballInfo.color}`}></span>
                      {ballInfo.label}
                    </div>
                    {booking.pitchType && (
                      <>
                        <span className="text-gray-200">|</span>
                        <span className="text-xs text-gray-500">{booking.pitchType}</span>
                      </>
                    )}
                    <span className="text-gray-200">|</span>
                    <span className="text-xs text-gray-500">{booking.playerName}</span>
                    {booking.ballType === 'TENNIS' && (
                      <>
                        <span className="text-gray-200">|</span>
                        <span className={`text-xs ${booking.operationMode === 'SELF_OPERATE' ? 'text-orange-500' : 'text-blue-500'}`}>
                          {booking.operationMode === 'SELF_OPERATE' ? 'Self' : 'Operator'}
                        </span>
                      </>
                    )}
                  </div>

                  {/* Price */}
                  {booking.price != null && (
                    <div className="flex items-center gap-1">
                      <IndianRupee className="w-3 h-3 text-gray-400" />
                      <span className="text-sm font-semibold text-gray-900">{booking.price}</span>
                      {hasDiscount && (
                        <span className="text-[10px] text-green-600 line-through ml-1">₹{booking.originalPrice}</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
