'use client';

import { useState, useEffect } from 'react';
import { format, addDays, parseISO } from 'date-fns';
import { Calendar, Check, Loader2 } from 'lucide-react';

export default function SlotsPage() {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [category, setCategory] = useState<'TENNIS' | 'MACHINE'>('MACHINE');
  const [ballType, setBallType] = useState('LEATHER');
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

  const categories = [
    { value: 'MACHINE' as const, label: 'Leather Ball Machine', color: 'bg-red-500' },
    { value: 'TENNIS' as const, label: 'Tennis Ball Machine', color: 'bg-green-500' },
  ];

  const machineSubTypes = [
    { value: 'LEATHER', label: 'Leather', color: 'bg-red-500' },
    { value: 'MACHINE', label: 'Machine', color: 'bg-green-500' },
  ];

  const handleCategoryChange = (cat: 'TENNIS' | 'MACHINE') => {
    setCategory(cat);
    if (cat === 'TENNIS') {
      setBallType('TENNIS');
    } else {
      setBallType('LEATHER');
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-5 pb-28">
      {/* Page Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Calendar className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Book a Slot</h1>
          <p className="text-xs text-gray-400">Select date, type & time</p>
        </div>
      </div>

      {/* Bowling Machine Panel */}
      <div className="mb-5">
        <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wider">Bowling Machine</label>
        <div className="flex gap-2 items-start">
          {/* Leather Ball Machine Card */}
          <div className="flex-1">
            <button
              onClick={() => handleCategoryChange('MACHINE')}
              className={`w-full rounded-xl transition-all cursor-pointer text-left p-3 ${
                category === 'MACHINE'
                  ? 'bg-primary text-white shadow-md shadow-primary/20'
                  : 'bg-white text-gray-600 border border-gray-200 hover:border-primary/30'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-red-500"></span>
                <span className="text-sm font-semibold">Leather Ball Machine</span>
              </div>
              <p className={`text-[10px] mt-1 ${category === 'MACHINE' ? 'text-white/60' : 'text-gray-400'}`}>Select ball type</p>
            </button>

            {/* Ball type sub-selector */}
            {category === 'MACHINE' && (
              <div className="flex gap-2 mt-2">
                {machineSubTypes.map((type) => (
                  <button
                    key={type.value}
                    onClick={() => setBallType(type.value)}
                    className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      ballType === type.value
                        ? 'bg-primary/10 text-primary border border-primary/30'
                        : 'bg-gray-50 text-gray-500 border border-gray-100 hover:border-primary/20'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${type.color}`}></span>
                    {type.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Tennis Ball Machine Card */}
          <div className="flex-1">
            <button
              onClick={() => handleCategoryChange('TENNIS')}
              className={`w-full rounded-xl transition-all cursor-pointer text-left p-3 ${
                category === 'TENNIS'
                  ? 'bg-primary text-white shadow-md shadow-primary/20'
                  : 'bg-white text-gray-600 border border-gray-200 hover:border-primary/30'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500"></span>
                <span className="text-sm font-semibold">Tennis Ball Machine</span>
              </div>
              <p className={`text-[10px] mt-1 ${category === 'TENNIS' ? 'text-white/60' : 'text-gray-400'}`}>No options needed</p>
            </button>
          </div>
        </div>
      </div>

      {/* Date Selector - Horizontal scroll */}
      <div className="mb-6">
        <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wider">Select Date</label>
        <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide">
          {[0, 1, 2, 3, 4, 5, 6].map((days) => {
            const date = addDays(new Date(), days);
            const isSelected = format(selectedDate, 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd');
            const isToday = days === 0;
            return (
              <button
                key={days}
                onClick={() => setSelectedDate(date)}
                className={`flex-shrink-0 w-16 py-3 rounded-xl text-center transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-primary text-white shadow-md shadow-primary/20'
                    : 'bg-white text-gray-600 border border-gray-200 hover:border-primary/30'
                }`}
              >
                <div className={`text-[10px] uppercase font-medium ${isSelected ? 'text-white/70' : 'text-gray-400'}`}>
                  {isToday ? 'Today' : format(date, 'EEE')}
                </div>
                <div className="text-lg font-bold mt-0.5">{format(date, 'd')}</div>
                <div className={`text-[10px] ${isSelected ? 'text-white/60' : 'text-gray-400'}`}>
                  {format(date, 'MMM')}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Slots Grid */}
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wider">
          Available Slots
        </label>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <Loader2 className="w-6 h-6 animate-spin mb-2" />
            <span className="text-sm">Loading slots...</span>
          </div>
        ) : error ? (
          <div className="text-center py-16">
            <p className="text-red-500 text-sm">{error}</p>
            <button onClick={fetchSlots} className="mt-3 text-sm text-primary font-medium cursor-pointer">Try again</button>
          </div>
        ) : slots.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3">
              <Calendar className="w-5 h-5 text-gray-400" />
            </div>
            <p className="text-sm text-gray-500">No slots available for this date</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {slots.map((slot) => {
              const isSelected = selectedSlots.some(s => s.startTime === slot.startTime);
              const isBooked = slot.status === 'Booked';

              return (
                <button
                  key={slot.startTime}
                  disabled={isBooked || bookingLoading}
                  onClick={() => handleToggleSlot(slot)}
                  className={`relative p-3.5 rounded-xl transition-all text-left cursor-pointer ${
                    isBooked
                      ? 'bg-gray-50 border border-gray-100 cursor-not-allowed'
                      : isSelected
                      ? 'bg-primary text-white shadow-md shadow-primary/20 border border-primary'
                      : 'bg-white border border-gray-200 hover:border-primary/40 active:scale-[0.97]'
                  }`}
                >
                  {isSelected && (
                    <div className="absolute top-2 right-2">
                      <Check className="w-4 h-4" />
                    </div>
                  )}
                  <div className={`text-sm font-bold ${isBooked ? 'text-gray-300' : ''}`}>
                    {format(parseISO(slot.startTime), 'HH:mm')}
                  </div>
                  <div className={`text-[10px] mt-0.5 ${
                    isBooked ? 'text-gray-300' : isSelected ? 'text-white/70' : 'text-gray-400'
                  }`}>
                    to {format(parseISO(slot.endTime), 'HH:mm')}
                  </div>
                  <div className={`text-[10px] mt-1.5 font-semibold uppercase tracking-wider ${
                    isBooked ? 'text-red-300' : isSelected ? 'text-white/80' : 'text-green-500'
                  }`}>
                    {isBooked ? 'Booked' : isSelected ? 'Selected' : 'Open'}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Fixed Bottom Booking Bar */}
      {selectedSlots.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-gray-200 p-4 z-40 safe-bottom">
          <div className="max-w-2xl mx-auto flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-bold text-gray-900">{selectedSlots.length} slot{selectedSlots.length > 1 ? 's' : ''} selected</p>
              <p className="text-[11px] text-gray-400">{format(selectedDate, 'EEE, MMM d')} &middot; {ballType === 'TENNIS' ? 'Tennis Ball Machine' : ballType === 'LEATHER' ? 'Leather Ball Machine (Leather)' : 'Leather Ball Machine (Machine)'}</p>
            </div>
            <button
              onClick={handleBook}
              disabled={bookingLoading}
              className="flex items-center gap-2 bg-primary hover:bg-primary-light text-white px-6 py-3 rounded-xl font-semibold text-sm transition-all active:scale-[0.97] disabled:opacity-50 cursor-pointer"
            >
              {bookingLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Booking...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  Confirm
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
