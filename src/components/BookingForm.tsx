'use client';

import { useState, useEffect } from 'react';
import { bookingApi, SlotStatus, BallType } from '@/lib/api';
import { parseISO } from 'date-fns';

export default function BookingForm() {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [slots, setSlots] = useState<SlotStatus[]>([]);
  const [selectedSlots, setSelectedSlots] = useState<string[]>([]);
  const [playerName, setPlayerName] = useState('');
  const [machine, setMachine] = useState<'A' | 'B'>('B');
  const [ballType, setBallType] = useState<BallType>('TENNIS');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  useEffect(() => {
    // Reset ball type when machine changes
    if (machine === 'A') {
      setBallType('LEATHER');
    } else {
      setBallType('TENNIS');
    }
  }, [machine]);

  useEffect(() => {
    fetchSlots();
    setSelectedSlots([]);
  }, [date, ballType]);

  const fetchSlots = async () => {
    try {
      setLoading(true);
      const data = await bookingApi.getSlots(date, ballType);
      setSlots(data);
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to load slots' });
    } finally {
      setLoading(false);
    }
  };

  const handleBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedSlots.length === 0 || !playerName) return;

    try {
      setLoading(true);
      
      // Book all selected slots
      await Promise.all(selectedSlots.map(slotStartTime => 
        bookingApi.createBooking({
          startTime: slotStartTime,
          durationMinutes: 30, // Default duration per slot
          ballType,
          playerName,
        })
      ));

      setMessage({ type: 'success', text: `Successfully booked ${selectedSlots.length} slot(s)!` });
      setSelectedSlots([]);
      setPlayerName('');
      fetchSlots();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Booking failed' });
    } finally {
      setLoading(false);
    }
  };

  const toggleSlot = (startTime: string) => {
    setSelectedSlots(prev => 
      prev.includes(startTime) 
        ? prev.filter(s => s !== startTime) 
        : [...prev, startTime]
    );
  };

  return (
    <div className="max-w-md mx-auto p-6 bg-white rounded-lg shadow-md text-slate-800">
      <h2 className="text-2xl font-bold mb-6">Book a Net Session</h2>
      
      <div className="mb-4">
        <label className="block text-sm font-medium mb-1">Select Date</label>
        <input 
          type="date" 
          value={date} 
          onChange={(e) => setDate(e.target.value)}
          className="w-full p-2 border rounded"
          min={new Date().toISOString().split('T')[0]}
        />
      </div>

      <div className="mb-6">
        <label className="block text-sm font-medium mb-2">Available Slots (30 min)</label>
        {loading ? (
          <p>Loading slots...</p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {slots.map((slot) => (
              <button
                key={slot.startTime}
                type="button"
                disabled={slot.status !== 'Available'}
                onClick={() => toggleSlot(slot.startTime)}
                className={`p-2 text-sm border rounded ${
                  selectedSlots.includes(slot.startTime) 
                    ? 'bg-blue-600 text-white border-blue-600' 
                    : slot.status === 'Available'
                    ? 'hover:bg-blue-50 border-blue-200'
                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                }`}
              >
                {new Date(slot.startTime).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}
              </button>
            ))}
          </div>
        )}
      </div>

      <form onSubmit={handleBooking}>
        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">Player Name</label>
          <input 
            type="text" 
            required 
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            placeholder="Enter your name"
            className="w-full p-2 border rounded"
          />
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">Select Machine</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMachine('B')}
              className={`p-2 text-sm border rounded ${
                machine === 'B' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-200'
              }`}
            >
              Machine B (Tennis)
            </button>
            <button
              type="button"
              onClick={() => setMachine('A')}
              className={`p-2 text-sm border rounded ${
                machine === 'A' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-200'
              }`}
            >
              Machine A (Leather/Machine)
            </button>
          </div>
        </div>

        <div className="mb-6">
          <label className="block text-sm font-medium mb-1">Ball Type</label>
          <select 
            value={ballType} 
            onChange={(e) => setBallType(e.target.value as BallType)}
            className="w-full p-2 border rounded"
          >
            {machine === 'B' ? (
              <option value="TENNIS">Tennis Ball</option>
            ) : (
              <>
                <option value="LEATHER">Leather Ball</option>
                <option value="MACHINE">Bowling Machine Ball</option>
              </>
            )}
          </select>
        </div>

        <button 
          type="submit" 
          disabled={loading || selectedSlots.length === 0}
          className={`w-full p-3 text-white font-bold rounded ${
            loading || selectedSlots.length === 0 ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'
          }`}
        >
          {loading ? 'Processing...' : `Confirm Booking (${selectedSlots.length} slots)`}
        </button>
      </form>

      {message && (
        <div className={`mt-4 p-3 rounded ${message.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
          {message.text}
        </div>
      )}
    </div>
  );
}
