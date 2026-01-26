'use client';

import { useState, useEffect } from 'react';
import { format, addDays, startOfDay, parseISO } from 'date-fns';

export default function SlotsPage() {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [ballType, setBallType] = useState('TENNIS');
  const [slots, setSlots] = useState<any[]>([]);
  const [selectedSlots, setSelectedSlots] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [bookingLoading, setBookingLoading] = useState(false);

  useEffect(() => {
    fetchSlots();
    setSelectedSlots([]);
  }, [selectedDate, ballType]);

  const fetchSlots = async () => {
    setLoading(true);
    setError('');
    try {
      const dateStr = format(selectedDate, 'yyyy-MM-dd');
      const res = await fetch(`/api/slots/available?date=${dateStr}&ballType=${ballType}`);
      if (!res.ok) throw new Error('Failed to fetch slots');
      const data = await res.json();
      setSlots(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleSlot = (slot: any) => {
    if (slot.status === 'Booked') return;

    setSelectedSlots(prev => {
      const isSelected = prev.find(s => s.startTime === slot.startTime);
      if (isSelected) {
        return prev.filter(s => s.startTime !== slot.startTime);
      } else {
        return [...prev, slot];
      }
    });
  };

  const handleBook = async () => {
    if (selectedSlots.length === 0) return;

    const confirmBooking = window.confirm(`Are you sure you want to book ${selectedSlots.length} slot(s)?`);
    if (!confirmBooking) return;

    setBookingLoading(true);
    try {
      const res = await fetch('/api/slots/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(selectedSlots.map(slot => ({
          date: format(selectedDate, 'yyyy-MM-dd'),
          startTime: slot.startTime,
          endTime: slot.endTime,
          ballType: ballType,
          // playerName is now handled by the backend automatically from session
        }))),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Booking failed');
      }

      alert('Booking successful!');
      setSelectedSlots([]);
      fetchSlots();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setBookingLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6">
      <h1 className="text-2xl sm:text-3xl font-bold mb-6 sm:mb-8">Available Slots</h1>

      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">Select Ball Type</label>
        <div className="flex flex-wrap gap-2">
          {['TENNIS', 'LEATHER', 'MACHINE'].map((type) => (
            <button
              key={type}
              onClick={() => setBallType(type)}
              className={`px-4 py-2 rounded-md border ${
                ballType === type ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-200'
              }`}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-4 mb-8 overflow-x-auto pb-2">
        {[0, 1, 2, 3, 4, 5, 6].map((days) => {
          const date = addDays(new Date(), days);
          const isSelected = format(selectedDate, 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd');
          return (
            <button
              key={days}
              onClick={() => setSelectedDate(date)}
              className={`flex-shrink-0 p-4 rounded-lg border ${
                isSelected ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-200'
              }`}
            >
              <div className="text-xs uppercase">{format(date, 'EEE')}</div>
              <div className="text-xl font-bold">{format(date, 'd')}</div>
              <div className="text-xs">{format(date, 'MMM')}</div>
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="text-center py-12">Loading slots...</div>
      ) : error ? (
        <div className="text-red-600 text-center py-12">{error}</div>
      ) : slots.length === 0 ? (
        <div className="text-center py-12 text-gray-500">No slots available for this date.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {slots.map((slot) => {
              const isSelected = selectedSlots.some(s => s.startTime === slot.startTime);
              const isBooked = slot.status === 'Booked';

              return (
                <button
                  key={slot.startTime}
                  disabled={isBooked || bookingLoading}
                  onClick={() => handleToggleSlot(slot)}
                  className={`p-4 border rounded-lg transition-colors text-left ${
                    isBooked
                      ? 'bg-gray-100 border-gray-200 cursor-not-allowed'
                      : isSelected
                      ? 'bg-blue-50 border-blue-500 ring-1 ring-blue-500'
                      : 'bg-white border-gray-200 hover:border-blue-500'
                  }`}
                >
                  <div className={`font-semibold ${isBooked ? 'text-gray-400' : 'text-gray-900'}`}>
                    {format(parseISO(slot.startTime), 'HH:mm')} - {format(parseISO(slot.endTime), 'HH:mm')}
                  </div>
                  <div className={`text-xs mt-1 ${
                    isBooked ? 'text-red-500' : isSelected ? 'text-blue-600 font-medium' : 'text-blue-600'
                  }`}>
                    {isBooked ? 'Unavailable' : isSelected ? 'Selected' : 'Available'}
                  </div>
                </button>
              );
            })}
          </div>

          {selectedSlots.length > 0 && (
            <div className="mt-8 flex justify-center">
              <button
                onClick={handleBook}
                disabled={bookingLoading}
                className="bg-blue-600 text-white px-8 py-3 rounded-lg font-bold hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {bookingLoading ? 'Booking...' : `Book ${selectedSlots.length} Selected Slot(s)`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
