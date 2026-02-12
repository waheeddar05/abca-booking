'use client';

import { useState, useEffect, useCallback } from 'react';
import { format, addDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth, isSameDay, parseISO, isBefore, startOfDay } from 'date-fns';
import { Calendar, List, Plus, Loader2, ChevronLeft, ChevronRight, Pencil, Trash2, ToggleLeft, ToggleRight, Clock, IndianRupee, Save, X } from 'lucide-react';

interface Slot {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  price: number;
  isActive: boolean;
  isBooked: boolean;
  bookings: Array<{
    playerName: string;
    ballType: string;
    user?: { name: string; email: string };
  }>;
}

type ViewMode = 'calendar' | 'list';

export default function SlotManagement() {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('calendar');
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [showBulkCreate, setShowBulkCreate] = useState(false);
  const [showSingleCreate, setShowSingleCreate] = useState(false);
  const [editingSlot, setEditingSlot] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState('');
  const [message, setMessage] = useState({ text: '', type: '' });

  // Bulk create form
  const [bulkForm, setBulkForm] = useState({
    fromDate: format(new Date(), 'yyyy-MM-dd'),
    toDate: format(addDays(new Date(), 6), 'yyyy-MM-dd'),
    price: '600',
    startHour: '',
    endHour: '',
    duration: '',
  });

  // Single create form
  const [singleForm, setSingleForm] = useState({
    date: format(new Date(), 'yyyy-MM-dd'),
    startTime: '07:00',
    endTime: '07:30',
    price: '600',
  });

  const [bulkLoading, setBulkLoading] = useState(false);
  const [singleLoading, setSingleLoading] = useState(false);

  const fetchSlots = useCallback(async () => {
    setLoading(true);
    try {
      const from = format(startOfMonth(currentMonth), 'yyyy-MM-dd');
      const to = format(endOfMonth(currentMonth), 'yyyy-MM-dd');
      const res = await fetch(`/api/admin/slots?from=${from}&to=${to}`);
      if (res.ok) {
        const data = await res.json();
        setSlots(data);
      }
    } catch (error) {
      console.error('Failed to fetch slots', error);
    } finally {
      setLoading(false);
    }
  }, [currentMonth]);

  useEffect(() => {
    fetchSlots();
  }, [fetchSlots]);

  const handleBulkCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBulkLoading(true);
    setMessage({ text: '', type: '' });
    try {
      const body: any = {
        fromDate: bulkForm.fromDate,
        toDate: bulkForm.toDate,
        price: parseFloat(bulkForm.price),
      };
      if (bulkForm.startHour) body.startHour = parseInt(bulkForm.startHour);
      if (bulkForm.endHour) body.endHour = parseInt(bulkForm.endHour);
      if (bulkForm.duration) body.duration = parseInt(bulkForm.duration);

      const res = await fetch('/api/admin/slots/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ text: `${data.created} slots created, ${data.skipped} skipped`, type: 'success' });
        setShowBulkCreate(false);
        fetchSlots();
      } else {
        setMessage({ text: data.error || 'Failed to create slots', type: 'error' });
      }
    } catch (error) {
      setMessage({ text: 'Failed to create slots', type: 'error' });
    } finally {
      setBulkLoading(false);
    }
  };

  const handleSingleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSingleLoading(true);
    setMessage({ text: '', type: '' });
    try {
      const dateStr = singleForm.date;
      const startISO = new Date(`${dateStr}T${singleForm.startTime}:00+05:30`).toISOString();
      const endISO = new Date(`${dateStr}T${singleForm.endTime}:00+05:30`).toISOString();

      const res = await fetch('/api/admin/slots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: dateStr,
          startTime: startISO,
          endTime: endISO,
          price: parseFloat(singleForm.price),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ text: 'Slot created successfully', type: 'success' });
        setShowSingleCreate(false);
        fetchSlots();
      } else {
        setMessage({ text: data.error || 'Failed to create slot', type: 'error' });
      }
    } catch (error) {
      setMessage({ text: 'Failed to create slot', type: 'error' });
    } finally {
      setSingleLoading(false);
    }
  };

  const handleUpdatePrice = async (slotId: string) => {
    try {
      const res = await fetch('/api/admin/slots', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotId, price: parseFloat(editPrice) }),
      });
      const data = await res.json();
      if (res.ok) {
        setEditingSlot(null);
        fetchSlots();
      } else {
        alert(data.error || 'Failed to update price');
      }
    } catch {
      alert('Failed to update price');
    }
  };

  const handleToggleActive = async (slotId: string, isActive: boolean) => {
    try {
      const res = await fetch('/api/admin/slots', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotId, isActive: !isActive }),
      });
      if (res.ok) {
        fetchSlots();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to toggle slot');
      }
    } catch {
      alert('Failed to toggle slot');
    }
  };

  const handleDelete = async (slotId: string) => {
    if (!confirm('Delete this slot?')) return;
    try {
      const res = await fetch(`/api/admin/slots?id=${slotId}`, { method: 'DELETE' });
      if (res.ok) {
        fetchSlots();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to delete slot');
      }
    } catch {
      alert('Failed to delete slot');
    }
  };

  const formatTime = (iso: string) => {
    return new Date(iso).toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Calendar rendering
  const monthStart = startOfMonth(currentMonth);
  const weekStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const monthEnd = endOfMonth(currentMonth);
  const weekEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });

  const calendarDays: Date[] = [];
  let day = weekStart;
  while (day <= weekEnd) {
    calendarDays.push(day);
    day = addDays(day, 1);
  }

  const getSlotsForDate = (date: Date) => {
    return slots.filter(s => isSameDay(parseISO(s.date), date));
  };

  const selectedDateSlots = selectedDate ? getSlotsForDate(selectedDate) : [];

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
            <Clock className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Slot Management</h1>
            <p className="text-xs text-slate-400">Create and manage booking slots</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setViewMode(viewMode === 'calendar' ? 'list' : 'calendar')}
            className="p-2 text-slate-400 hover:text-accent hover:bg-accent/10 rounded-lg transition-colors cursor-pointer"
            title={viewMode === 'calendar' ? 'Switch to list view' : 'Switch to calendar view'}
          >
            {viewMode === 'calendar' ? <List className="w-5 h-5" /> : <Calendar className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-2 mb-5">
        <button
          onClick={() => { setShowBulkCreate(!showBulkCreate); setShowSingleCreate(false); }}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-accent text-primary rounded-lg text-sm font-medium hover:bg-accent-light transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          Bulk Create Slots
        </button>
        <button
          onClick={() => { setShowSingleCreate(!showSingleCreate); setShowBulkCreate(false); }}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-white/[0.06] text-slate-300 rounded-lg text-sm font-medium hover:bg-white/[0.1] transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          Create Single Slot
        </button>
      </div>

      {/* Message */}
      {message.text && (
        <div className={`mb-4 px-4 py-3 rounded-lg text-sm ${message.type === 'success' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
          {message.text}
        </div>
      )}

      {/* Bulk Create Form */}
      {showBulkCreate && (
        <div className="bg-white/[0.04] backdrop-blur-sm rounded-xl border border-white/[0.08] p-5 mb-5">
          <h2 className="text-sm font-semibold text-white mb-3">Bulk Create Slots</h2>
          <form onSubmit={handleBulkCreate} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">From Date</label>
                <input
                  type="date"
                  value={bulkForm.fromDate}
                  onChange={e => setBulkForm({ ...bulkForm, fromDate: e.target.value })}
                  required
                  className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 placeholder:text-slate-500"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">To Date</label>
                <input
                  type="date"
                  value={bulkForm.toDate}
                  onChange={e => setBulkForm({ ...bulkForm, toDate: e.target.value })}
                  required
                  className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 placeholder:text-slate-500"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Price per Slot</label>
                <input
                  type="number"
                  value={bulkForm.price}
                  onChange={e => setBulkForm({ ...bulkForm, price: e.target.value })}
                  min="0"
                  step="1"
                  className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 placeholder:text-slate-500"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Start Hour (opt)</label>
                <input
                  type="number"
                  value={bulkForm.startHour}
                  onChange={e => setBulkForm({ ...bulkForm, startHour: e.target.value })}
                  min="0"
                  max="23"
                  placeholder="e.g. 7"
                  className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 placeholder:text-slate-500"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">End Hour (opt)</label>
                <input
                  type="number"
                  value={bulkForm.endHour}
                  onChange={e => setBulkForm({ ...bulkForm, endHour: e.target.value })}
                  min="0"
                  max="24"
                  placeholder="e.g. 22"
                  className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 placeholder:text-slate-500"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Duration (opt)</label>
                <input
                  type="number"
                  value={bulkForm.duration}
                  onChange={e => setBulkForm({ ...bulkForm, duration: e.target.value })}
                  min="15"
                  step="15"
                  placeholder="e.g. 30"
                  className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 placeholder:text-slate-500"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={bulkLoading}
                className="inline-flex items-center gap-2 bg-accent hover:bg-accent-light text-primary px-5 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-50"
              >
                {bulkLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Create Slots
              </button>
              <button
                type="button"
                onClick={() => setShowBulkCreate(false)}
                className="px-4 py-2.5 bg-white/[0.06] text-slate-300 rounded-lg text-sm font-medium hover:bg-white/[0.1] transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Single Create Form */}
      {showSingleCreate && (
        <div className="bg-white/[0.04] backdrop-blur-sm rounded-xl border border-white/[0.08] p-5 mb-5">
          <h2 className="text-sm font-semibold text-white mb-3">Create Single Slot</h2>
          <form onSubmit={handleSingleCreate} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Date</label>
                <input
                  type="date"
                  value={singleForm.date}
                  onChange={e => setSingleForm({ ...singleForm, date: e.target.value })}
                  required
                  className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 placeholder:text-slate-500"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Start Time</label>
                <input
                  type="time"
                  value={singleForm.startTime}
                  onChange={e => setSingleForm({ ...singleForm, startTime: e.target.value })}
                  required
                  className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 placeholder:text-slate-500"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">End Time</label>
                <input
                  type="time"
                  value={singleForm.endTime}
                  onChange={e => setSingleForm({ ...singleForm, endTime: e.target.value })}
                  required
                  className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 placeholder:text-slate-500"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Price</label>
                <input
                  type="number"
                  value={singleForm.price}
                  onChange={e => setSingleForm({ ...singleForm, price: e.target.value })}
                  min="0"
                  step="1"
                  className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 placeholder:text-slate-500"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={singleLoading}
                className="inline-flex items-center gap-2 bg-accent hover:bg-accent-light text-primary px-5 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-50"
              >
                {singleLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Create Slot
              </button>
              <button
                type="button"
                onClick={() => setShowSingleCreate(false)}
                className="px-4 py-2.5 bg-white/[0.06] text-slate-300 rounded-lg text-sm font-medium hover:bg-white/[0.1] transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Calendar View */}
      {viewMode === 'calendar' && (
        <div className="bg-white/[0.04] backdrop-blur-sm rounded-xl border border-white/[0.08] p-4 mb-5">
          {/* Month Navigation */}
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}
              className="p-2 hover:bg-white/[0.06] rounded-lg transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-5 h-5 text-slate-400" />
            </button>
            <h3 className="text-sm font-semibold text-white">
              {format(currentMonth, 'MMMM yyyy')}
            </h3>
            <button
              onClick={() => setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}
              className="p-2 hover:bg-white/[0.06] rounded-lg transition-colors cursor-pointer"
            >
              <ChevronRight className="w-5 h-5 text-slate-400" />
            </button>
          </div>

          {/* Day Headers */}
          <div className="grid grid-cols-7 gap-1 mb-1">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
              <div key={d} className="text-center text-[10px] font-semibold text-slate-500 uppercase py-1">
                {d}
              </div>
            ))}
          </div>

          {/* Calendar Grid */}
          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((calDay, i) => {
              const isCurrentMonth = calDay.getMonth() === currentMonth.getMonth();
              const isSelected = selectedDate && isSameDay(calDay, selectedDate);
              const daySlots = getSlotsForDate(calDay);
              const hasSlots = daySlots.length > 0;
              const bookedSlots = daySlots.filter(s => s.isBooked).length;
              const isPast = isBefore(calDay, startOfDay(new Date()));

              return (
                <button
                  key={i}
                  onClick={() => setSelectedDate(calDay)}
                  className={`relative p-2 rounded-lg text-center transition-all cursor-pointer min-h-[60px] ${
                    isSelected
                      ? 'bg-accent text-primary ring-2 ring-accent/30'
                      : isCurrentMonth
                        ? 'hover:bg-white/[0.04]'
                        : 'opacity-30'
                  } ${isPast && !isSelected ? 'opacity-50' : ''}`}
                >
                  <div className={`text-xs font-medium ${isSelected ? 'text-primary' : 'text-slate-300'}`}>
                    {format(calDay, 'd')}
                  </div>
                  {hasSlots && (
                    <div className="mt-1">
                      <div className={`text-[9px] font-medium ${isSelected ? 'text-primary/80' : 'text-accent'}`}>
                        {daySlots.length} slots
                      </div>
                      {bookedSlots > 0 && (
                        <div className={`text-[9px] ${isSelected ? 'text-primary/60' : 'text-orange-500'}`}>
                          {bookedSlots} booked
                        </div>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Selected Date Slots / List View */}
      {(viewMode === 'list' || selectedDate) && (
        <div>
          {viewMode === 'calendar' && selectedDate && (
            <h3 className="text-sm font-semibold text-white mb-3">
              Slots for {format(selectedDate, 'EEE, MMM d, yyyy')}
            </h3>
          )}

          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin mb-2" />
              <span className="text-sm">Loading slots...</span>
            </div>
          ) : (
            (() => {
              const displaySlots = viewMode === 'list' ? slots : selectedDateSlots;
              if (displaySlots.length === 0) {
                return (
                  <div className="text-center py-12">
                    <div className="w-12 h-12 rounded-full bg-white/[0.04] flex items-center justify-center mx-auto mb-3">
                      <Clock className="w-5 h-5 text-slate-500" />
                    </div>
                    <p className="text-sm text-slate-400">
                      {viewMode === 'calendar' ? 'No slots for this date' : 'No slots found for this month'}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">Use Bulk Create to add slots</p>
                  </div>
                );
              }

              // Group by date for list view
              const grouped: Record<string, Slot[]> = {};
              for (const s of displaySlots) {
                const dateKey = s.date.split('T')[0];
                if (!grouped[dateKey]) grouped[dateKey] = [];
                grouped[dateKey].push(s);
              }

              return Object.entries(grouped).map(([dateKey, dateSlots]) => (
                <div key={dateKey} className="mb-4">
                  {viewMode === 'list' && (
                    <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                      {format(parseISO(dateKey), 'EEE, MMM d, yyyy')}
                    </div>
                  )}
                  <div className="space-y-2">
                    {dateSlots.map(slot => (
                      <div
                        key={slot.id}
                        className={`bg-white/[0.04] rounded-xl border p-4 flex items-center justify-between ${
                          slot.isActive ? 'border-white/[0.08]' : 'border-white/[0.04] bg-white/[0.02] opacity-60'
                        }`}
                      >
                        <div className="flex items-center gap-4 flex-1 min-w-0">
                          <div className="flex-shrink-0">
                            <div className="text-sm font-semibold text-white">
                              {formatTime(slot.startTime)} - {formatTime(slot.endTime)}
                            </div>
                            {slot.isBooked && (
                              <div className="text-[10px] text-orange-500 font-medium mt-0.5">
                                Booked: {slot.bookings?.[0]?.playerName || 'Unknown'}
                              </div>
                            )}
                            {!slot.isActive && (
                              <div className="text-[10px] text-slate-500 font-medium mt-0.5">Inactive</div>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            {editingSlot === slot.id ? (
                              <div className="flex items-center gap-1">
                                <IndianRupee className="w-3 h-3 text-slate-400" />
                                <input
                                  type="number"
                                  value={editPrice}
                                  onChange={e => setEditPrice(e.target.value)}
                                  className="w-20 bg-white/[0.04] border border-white/[0.1] rounded px-2 py-1 text-sm text-white outline-none focus:border-accent"
                                  autoFocus
                                />
                                <button
                                  onClick={() => handleUpdatePrice(slot.id)}
                                  className="p-1 text-green-400 hover:bg-green-500/10 rounded cursor-pointer"
                                >
                                  <Save className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => setEditingSlot(null)}
                                  className="p-1 text-slate-400 hover:bg-white/[0.06] rounded cursor-pointer"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => {
                                  if (!slot.isBooked) {
                                    setEditingSlot(slot.id);
                                    setEditPrice(String(slot.price));
                                  }
                                }}
                                className={`inline-flex items-center gap-1 px-2 py-1 rounded text-sm font-medium ${
                                  slot.isBooked
                                    ? 'text-slate-400 bg-white/[0.04]'
                                    : 'text-accent bg-accent/10 hover:bg-accent/20 cursor-pointer'
                                }`}
                                disabled={slot.isBooked}
                              >
                                <IndianRupee className="w-3 h-3" />
                                {slot.price}
                                {!slot.isBooked && <Pencil className="w-2.5 h-2.5 ml-1 opacity-50" />}
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 ml-3">
                          <button
                            onClick={() => handleToggleActive(slot.id, slot.isActive)}
                            className={`p-2 rounded-lg transition-colors cursor-pointer ${
                              slot.isActive ? 'text-green-400 hover:bg-green-500/10' : 'text-slate-500 hover:bg-white/[0.06]'
                            }`}
                            title={slot.isActive ? 'Deactivate slot' : 'Activate slot'}
                          >
                            {slot.isActive ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
                          </button>
                          {!slot.isBooked && (
                            <button
                              onClick={() => handleDelete(slot.id)}
                              className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer"
                              title="Delete slot"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ));
            })()
          )}
        </div>
      )}
    </div>
  );
}
