'use client';

import { useState, useEffect, useCallback } from 'react';
import { format, addDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth, isSameDay, parseISO, isBefore, startOfDay } from 'date-fns';
import { Calendar, List, Loader2, ChevronLeft, ChevronRight, Pencil, Trash2, ToggleLeft, ToggleRight, Clock, IndianRupee, Save, X, ShieldBan, Ban, AlertTriangle } from 'lucide-react';

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

interface BlockedSlot {
  id: string;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  machineType: string | null;
  pitchType: string | null;
  reason: string | null;
  blockedBy: string;
  createdAt: string;
}

type ViewMode = 'calendar' | 'list';

export default function SlotManagement() {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('calendar');
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [editingSlot, setEditingSlot] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState('');
  const [message, setMessage] = useState({ text: '', type: '' });

  // Block Slots
  const [showBlockForm, setShowBlockForm] = useState(false);
  const [blockedSlots, setBlockedSlots] = useState<BlockedSlot[]>([]);
  const [blockedLoading, setBlockedLoading] = useState(false);
  const [blockForm, setBlockForm] = useState({
    startDate: format(new Date(), 'yyyy-MM-dd'),
    endDate: format(new Date(), 'yyyy-MM-dd'),
    startTime: '',
    endTime: '',
    blockType: 'all' as 'all' | 'machine' | 'pitch',
    machineType: '' as '' | 'LEATHER' | 'TENNIS',
    pitchType: '' as '' | 'ASTRO' | 'TURF',
    reason: '',
  });
  const [blockLoading, setBlockLoading] = useState(false);

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

  const fetchBlockedSlots = useCallback(async () => {
    setBlockedLoading(true);
    try {
      const res = await fetch('/api/admin/slots/block');
      if (res.ok) {
        const data = await res.json();
        setBlockedSlots(data);
      }
    } catch (error) {
      console.error('Failed to fetch blocked slots', error);
    } finally {
      setBlockedLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSlots();
  }, [fetchSlots]);

  useEffect(() => {
    fetchBlockedSlots();
  }, [fetchBlockedSlots]);

  const handleBlockSlots = async (e: React.FormEvent) => {
    e.preventDefault();
    setBlockLoading(true);
    setMessage({ text: '', type: '' });

    try {
      const body: any = {
        startDate: blockForm.startDate,
        endDate: blockForm.endDate,
        reason: blockForm.reason || null,
      };

      if (blockForm.startTime && blockForm.endTime) {
        body.startTime = blockForm.startTime;
        body.endTime = blockForm.endTime;
      }

      if (blockForm.blockType === 'machine' && blockForm.machineType) {
        body.machineType = blockForm.machineType;
      } else if (blockForm.blockType === 'pitch' && blockForm.pitchType) {
        body.pitchType = blockForm.pitchType;
      }

      const res = await fetch('/api/admin/slots/block', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        const parts = ['Slots blocked successfully'];
        if (data.cancelledBookingsCount > 0) {
          parts.push(`${data.cancelledBookingsCount} conflicting booking(s) cancelled`);
        }
        setMessage({ text: parts.join('. '), type: 'success' });
        setShowBlockForm(false);
        setBlockForm({
          startDate: format(new Date(), 'yyyy-MM-dd'),
          endDate: format(new Date(), 'yyyy-MM-dd'),
          startTime: '',
          endTime: '',
          blockType: 'all',
          machineType: '',
          pitchType: '',
          reason: '',
        });
        fetchBlockedSlots();
        fetchSlots();
      } else {
        setMessage({ text: data.error || 'Failed to block slots', type: 'error' });
      }
    } catch (error) {
      setMessage({ text: 'Failed to block slots', type: 'error' });
    } finally {
      setBlockLoading(false);
    }
  };

  const handleUnblock = async (id: string) => {
    if (!confirm('Remove this block? This will not restore any previously cancelled bookings.')) return;
    try {
      const res = await fetch(`/api/admin/slots/block?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        setMessage({ text: 'Block removed successfully', type: 'success' });
        fetchBlockedSlots();
      } else {
        const data = await res.json();
        setMessage({ text: data.error || 'Failed to remove block', type: 'error' });
      }
    } catch {
      setMessage({ text: 'Failed to remove block', type: 'error' });
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

  const formatBlockTime = (iso: string | null) => {
    if (!iso) return null;
    const d = new Date(iso);
    const h = d.getUTCHours().toString().padStart(2, '0');
    const m = d.getUTCMinutes().toString().padStart(2, '0');
    return `${h}:${m}`;
  };

  const getMachineLabel = (type: string | null) => {
    if (!type) return 'All Machines';
    if (type === 'LEATHER' || type === 'MACHINE') return 'Leather Ball Machine';
    if (type === 'TENNIS') return 'Tennis Ball Machine';
    return type;
  };

  const getPitchLabel = (type: string | null) => {
    if (!type) return 'All Pitches';
    if (type === 'ASTRO') return 'Astro Turf';
    if (type === 'TURF') return 'Cement Wicket';
    return type;
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
            <p className="text-xs text-slate-400">Manage booking slots & block sessions</p>
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
          onClick={() => setShowBlockForm(!showBlockForm)}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-red-500/15 text-red-400 border border-red-500/20 rounded-lg text-sm font-medium hover:bg-red-500/25 transition-colors cursor-pointer"
        >
          <ShieldBan className="w-4 h-4" />
          Block Slots
        </button>
      </div>

      {/* Message */}
      {message.text && (
        <div className={`mb-4 px-4 py-3 rounded-lg text-sm ${message.type === 'success' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
          {message.text}
        </div>
      )}

      {/* Block Slots Form */}
      {showBlockForm && (
        <div className="bg-white/[0.04] backdrop-blur-sm rounded-xl border border-red-500/20 p-5 mb-5">
          <div className="flex items-center gap-2 mb-4">
            <ShieldBan className="w-4 h-4 text-red-400" />
            <h2 className="text-sm font-semibold text-white">Block Slots</h2>
          </div>
          <div className="mb-3 px-3 py-2.5 bg-amber-500/10 border border-amber-500/20 rounded-lg flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
            <p className="text-[11px] text-amber-400">
              Blocking slots will automatically cancel any existing bookings in the selected range. Affected users will be notified.
            </p>
          </div>
          <form onSubmit={handleBlockSlots} className="space-y-4">
            {/* Date Range */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">From Date</label>
                <input
                  type="date"
                  value={blockForm.startDate}
                  onChange={e => setBlockForm({ ...blockForm, startDate: e.target.value })}
                  required
                  className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-red-400 focus:ring-1 focus:ring-red-400/20 placeholder:text-slate-500"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">To Date</label>
                <input
                  type="date"
                  value={blockForm.endDate}
                  onChange={e => setBlockForm({ ...blockForm, endDate: e.target.value })}
                  required
                  className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-red-400 focus:ring-1 focus:ring-red-400/20 placeholder:text-slate-500"
                />
              </div>
            </div>

            {/* Time Range (Optional) */}
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Time Range (Optional - leave empty to block full day)</label>
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="time"
                  value={blockForm.startTime}
                  onChange={e => setBlockForm({ ...blockForm, startTime: e.target.value })}
                  placeholder="Start time"
                  className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-red-400 focus:ring-1 focus:ring-red-400/20 placeholder:text-slate-500"
                />
                <input
                  type="time"
                  value={blockForm.endTime}
                  onChange={e => setBlockForm({ ...blockForm, endTime: e.target.value })}
                  placeholder="End time"
                  className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-red-400 focus:ring-1 focus:ring-red-400/20 placeholder:text-slate-500"
                />
              </div>
            </div>

            {/* Block Type */}
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-2">Block Type</label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setBlockForm({ ...blockForm, blockType: 'all', machineType: '', pitchType: '' })}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    blockForm.blockType === 'all'
                      ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                      : 'bg-white/[0.04] text-slate-400 border border-white/[0.08] hover:border-red-500/20'
                  }`}
                >
                  <Ban className="w-3.5 h-3.5 inline mr-1.5" />
                  Block All Slots
                </button>
                <button
                  type="button"
                  onClick={() => setBlockForm({ ...blockForm, blockType: 'machine', pitchType: '', machineType: 'LEATHER' })}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    blockForm.blockType === 'machine'
                      ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                      : 'bg-white/[0.04] text-slate-400 border border-white/[0.08] hover:border-red-500/20'
                  }`}
                >
                  By Machine Type
                </button>
                <button
                  type="button"
                  onClick={() => setBlockForm({ ...blockForm, blockType: 'pitch', machineType: '', pitchType: 'ASTRO' })}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    blockForm.blockType === 'pitch'
                      ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                      : 'bg-white/[0.04] text-slate-400 border border-white/[0.08] hover:border-red-500/20'
                  }`}
                >
                  By Pitch Type
                </button>
              </div>
            </div>

            {/* Machine Type Selection */}
            {blockForm.blockType === 'machine' && (
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-2">Machine Type</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setBlockForm({ ...blockForm, machineType: 'LEATHER' })}
                    className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      blockForm.machineType === 'LEATHER'
                        ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                        : 'bg-white/[0.04] text-slate-400 border border-white/[0.08] hover:border-red-500/20'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-red-500"></span>
                    Leather Ball Machine
                  </button>
                  <button
                    type="button"
                    onClick={() => setBlockForm({ ...blockForm, machineType: 'TENNIS' })}
                    className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      blockForm.machineType === 'TENNIS'
                        ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                        : 'bg-white/[0.04] text-slate-400 border border-white/[0.08] hover:border-red-500/20'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-green-500"></span>
                    Tennis Ball Machine
                  </button>
                </div>
              </div>
            )}

            {/* Pitch Type Selection */}
            {blockForm.blockType === 'pitch' && (
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-2">Pitch Type</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setBlockForm({ ...blockForm, pitchType: 'ASTRO' })}
                    className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      blockForm.pitchType === 'ASTRO'
                        ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                        : 'bg-white/[0.04] text-slate-400 border border-white/[0.08] hover:border-red-500/20'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                    Astro Turf
                  </button>
                  <button
                    type="button"
                    onClick={() => setBlockForm({ ...blockForm, pitchType: 'TURF' })}
                    className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      blockForm.pitchType === 'TURF'
                        ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                        : 'bg-white/[0.04] text-slate-400 border border-white/[0.08] hover:border-red-500/20'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                    Cement Wicket
                  </button>
                </div>
              </div>
            )}

            {/* Reason */}
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Reason (Optional)</label>
              <input
                type="text"
                value={blockForm.reason}
                onChange={e => setBlockForm({ ...blockForm, reason: e.target.value })}
                placeholder="e.g., Pitch maintenance, Machine repair..."
                className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-red-400 focus:ring-1 focus:ring-red-400/20 placeholder:text-slate-500"
              />
            </div>

            {/* Submit */}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={blockLoading}
                className="inline-flex items-center gap-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 px-5 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-50"
              >
                {blockLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldBan className="w-4 h-4" />}
                Block Slots
              </button>
              <button
                type="button"
                onClick={() => setShowBlockForm(false)}
                className="px-4 py-2.5 bg-white/[0.06] text-slate-300 rounded-lg text-sm font-medium hover:bg-white/[0.1] transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Active Blocked Slots */}
      {blockedSlots.length > 0 && (
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-3">
            <Ban className="w-4 h-4 text-red-400" />
            <h3 className="text-sm font-semibold text-white">Active Blocks</h3>
            <span className="text-[10px] text-slate-500 bg-white/[0.04] px-2 py-0.5 rounded-full">{blockedSlots.length}</span>
          </div>
          <div className="space-y-2">
            {blockedSlots.map(block => (
              <div
                key={block.id}
                className="bg-red-500/[0.06] border border-red-500/15 rounded-xl p-3.5 flex items-start justify-between gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="text-xs font-semibold text-white">
                      {format(parseISO(block.startDate), 'MMM d, yyyy')}
                      {block.startDate !== block.endDate && ` - ${format(parseISO(block.endDate), 'MMM d, yyyy')}`}
                    </span>
                    {block.startTime && block.endTime && (
                      <span className="text-[10px] text-slate-400 bg-white/[0.04] px-1.5 py-0.5 rounded">
                        {formatBlockTime(block.startTime)} - {formatBlockTime(block.endTime)}
                      </span>
                    )}
                    {!block.startTime && (
                      <span className="text-[10px] text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded font-medium">
                        Full Day
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {block.machineType ? (
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                        block.machineType === 'TENNIS'
                          ? 'bg-green-500/10 text-green-400'
                          : 'bg-red-500/10 text-red-400'
                      }`}>
                        {getMachineLabel(block.machineType)}
                      </span>
                    ) : block.pitchType ? (
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                        block.pitchType === 'ASTRO'
                          ? 'bg-emerald-500/10 text-emerald-400'
                          : 'bg-amber-500/10 text-amber-400'
                      }`}>
                        {getPitchLabel(block.pitchType)}
                      </span>
                    ) : (
                      <span className="text-[10px] font-medium text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded">
                        All Slots
                      </span>
                    )}
                    {block.reason && (
                      <span className="text-[10px] text-slate-400 truncate">
                        {block.reason}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => handleUnblock(block.id)}
                  className="flex-shrink-0 p-2 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer"
                  title="Remove block"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
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
