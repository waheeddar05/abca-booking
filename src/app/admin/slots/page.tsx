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
  machineId: string | null;
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
    machineIds: [] as string[],
    pitchType: '' as '' | 'ASTRO' | 'CEMENT' | 'NATURAL',
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

  const todayStr = format(new Date(), 'yyyy-MM-dd');

  const handleBlockSlots = async (e: React.FormEvent) => {
    e.preventDefault();

    // Past date validation
    if (blockForm.startDate < todayStr) {
      setMessage({ text: 'Start date cannot be in the past', type: 'error' });
      return;
    }
    if (blockForm.endDate < todayStr) {
      setMessage({ text: 'End date cannot be in the past', type: 'error' });
      return;
    }
    // If blocking today and a time is set, validate it's not past
    if (blockForm.startDate === todayStr && blockForm.startTime) {
      const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
      const [h, m] = blockForm.startTime.split(':').map(Number);
      if (h * 60 + m < nowMins) {
        setMessage({ text: 'Start time cannot be in the past for today', type: 'error' });
        return;
      }
    }

    setBlockLoading(true);
    setMessage({ text: '', type: '' });

    try {
      // If specific machines selected, create one block per machine
      if (blockForm.machineIds.length > 0) {
        let totalCancelled = 0;
        let successCount = 0;
        for (const machineId of blockForm.machineIds) {
          const body: any = {
            startDate: blockForm.startDate,
            endDate: blockForm.endDate,
            reason: blockForm.reason || null,
            machineId,
          };
          if (blockForm.startTime && blockForm.endTime) {
            body.startTime = blockForm.startTime;
            body.endTime = blockForm.endTime;
          }
          const res = await fetch('/api/admin/slots/block', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          const data = await res.json();
          if (res.ok) {
            successCount++;
            totalCancelled += data.cancelledBookingsCount || 0;
          }
        }
        const parts = [`${successCount} machine(s) blocked successfully`];
        if (totalCancelled > 0) parts.push(`${totalCancelled} booking(s) cancelled`);
        setMessage({ text: parts.join('. '), type: 'success' });
      } else {
        const body: any = {
          startDate: blockForm.startDate,
          endDate: blockForm.endDate,
          reason: blockForm.reason || null,
        };
        if (blockForm.startTime && blockForm.endTime) {
          body.startTime = blockForm.startTime;
          body.endTime = blockForm.endTime;
        }
        if (blockForm.blockType === 'pitch' && blockForm.pitchType) {
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
          if (data.cancelledBookingsCount > 0) parts.push(`${data.cancelledBookingsCount} booking(s) cancelled`);
          setMessage({ text: parts.join('. '), type: 'success' });
        } else {
          setMessage({ text: data.error || 'Failed to block slots', type: 'error' });
          setBlockLoading(false);
          return;
        }
      }

      setShowBlockForm(false);
      setBlockForm({
        startDate: format(new Date(), 'yyyy-MM-dd'),
        endDate: format(new Date(), 'yyyy-MM-dd'),
        startTime: '',
        endTime: '',
        blockType: 'all',
        machineIds: [],
        pitchType: '',
        reason: '',
      });
      fetchBlockedSlots();
      fetchSlots();
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

  const getMachineIdLabel = (id: string | null) => {
    if (!id) return null;
    const labels: Record<string, string> = {
      GRAVITY: 'Gravity (Leather)',
      YANTRA: 'Yantra (Premium Leather)',
      LEVERAGE_INDOOR: 'Leverage Tennis (Indoor)',
      LEVERAGE_OUTDOOR: 'Leverage Tennis (Outdoor)',
    };
    return labels[id] || id;
  };

  const getPitchLabel = (type: string | null) => {
    if (!type) return 'All Pitches';
    if (type === 'ASTRO') return 'Astro Turf';
    if (type === 'CEMENT') return 'Cement';
    if (type === 'NATURAL') return 'Natural Turf';
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
                  min={todayStr}
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
                  min={blockForm.startDate || todayStr}
                  onChange={e => setBlockForm({ ...blockForm, endDate: e.target.value })}
                  required
                  className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-red-400 focus:ring-1 focus:ring-red-400/20 placeholder:text-slate-500"
                />
              </div>
            </div>

            {/* Full Day Checkbox */}
            <div>
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!blockForm.startTime && !blockForm.endTime}
                  onChange={e => {
                    if (e.target.checked) {
                      setBlockForm({ ...blockForm, startTime: '', endTime: '' });
                    } else {
                      setBlockForm({ ...blockForm, startTime: '07:00', endTime: '22:30' });
                    }
                  }}
                  className="w-4 h-4 rounded border-slate-500 bg-white/[0.04] text-red-500 focus:ring-red-400/30 cursor-pointer"
                />
                <span className="text-xs font-semibold text-white">Full Day</span>
                <span className="text-[10px] text-slate-500">Block entire selected dates</span>
              </label>
            </div>

            {/* Time Range - only shown when Full Day is unchecked */}
            {(blockForm.startTime || blockForm.endTime) && (
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Time Range</label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] text-slate-500 mb-1">From Time</label>
                    <input
                      type="time"
                      value={blockForm.startTime}
                      onChange={e => setBlockForm({ ...blockForm, startTime: e.target.value })}
                      required
                      className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-red-400 focus:ring-1 focus:ring-red-400/20 placeholder:text-slate-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-500 mb-1">To Time</label>
                    <input
                      type="time"
                      value={blockForm.endTime}
                      onChange={e => setBlockForm({ ...blockForm, endTime: e.target.value })}
                      required
                      className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-red-400 focus:ring-1 focus:ring-red-400/20 placeholder:text-slate-500"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Machine Selection - 4 boxes with multi-select */}
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-2">Select Machines (multi-select)</label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { id: 'GRAVITY', label: 'Gravity', sub: 'Leather', image: '/images/leathermachine.jpeg' },
                  { id: 'YANTRA', label: 'Yantra', sub: 'Premium Leather', image: '/images/yantra-machine.jpeg' },
                  { id: 'LEVERAGE_INDOOR', label: 'Leverage Tennis', sub: 'Indoor', image: '/images/tennismachine.jpeg' },
                  { id: 'LEVERAGE_OUTDOOR', label: 'Leverage Tennis', sub: 'Outdoor', image: '/images/tennismachine.jpeg' },
                ]).map(m => {
                  const isSelected = blockForm.machineIds.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        setBlockForm(prev => ({
                          ...prev,
                          blockType: 'machine',
                          machineIds: isSelected
                            ? prev.machineIds.filter(id => id !== m.id)
                            : [...prev.machineIds, m.id],
                        }));
                      }}
                      className={`flex items-center gap-2.5 px-2.5 py-2 rounded-xl transition-all cursor-pointer text-left ${
                        isSelected
                          ? 'bg-red-500/15 ring-2 ring-red-500/50 shadow-sm'
                          : 'bg-white/[0.04] border border-white/[0.08] hover:border-red-500/30'
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={m.image}
                        alt={m.label}
                        className="w-9 h-9 rounded-lg object-cover flex-shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <span className={`text-[11px] font-bold truncate block ${isSelected ? 'text-red-400' : 'text-slate-300'}`}>
                          {m.label}
                        </span>
                        <p className={`text-[9px] ${isSelected ? 'text-red-400/70' : 'text-slate-600'}`}>
                          {m.sub}
                        </p>
                      </div>
                      <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                        isSelected ? 'bg-red-500 border-red-500' : 'border-slate-500'
                      }`}>
                        {isSelected && <span className="text-white text-[8px] font-bold">✓</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-slate-500 mt-1.5">Leave empty to block all machines</p>
            </div>

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

            {/* Submit - only Block button + Reset */}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={blockLoading}
                className="inline-flex items-center gap-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 px-5 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-50"
              >
                {blockLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldBan className="w-4 h-4" />}
                Block
              </button>
              <button
                type="button"
                onClick={() => {
                  setBlockForm({
                    startDate: format(new Date(), 'yyyy-MM-dd'),
                    endDate: format(new Date(), 'yyyy-MM-dd'),
                    startTime: '',
                    endTime: '',
                    blockType: 'all',
                    machineIds: [],
                    pitchType: '',
                    reason: '',
                  });
                }}
                className="px-4 py-2.5 bg-white/[0.06] text-slate-300 rounded-lg text-sm font-medium hover:bg-white/[0.1] transition-colors cursor-pointer"
              >
                Reset
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
                    {block.machineId ? (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400">
                        {getMachineIdLabel(block.machineId)}
                      </span>
                    ) : block.machineType ? (
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
                          : block.pitchType === 'CEMENT'
                          ? 'bg-amber-500/10 text-amber-400'
                          : block.pitchType === 'NATURAL'
                          ? 'bg-lime-500/10 text-lime-400'
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
              const totalBookings = daySlots.reduce((sum, s) => sum + (s.bookings?.length || 0), 0);
              const isPast = isBefore(calDay, startOfDay(new Date()));

              // Check if any blocked slots overlap this day
              const dayStr = format(calDay, 'yyyy-MM-dd');
              const hasBlocks = blockedSlots.some(b => {
                const blockStart = b.startDate.split('T')[0];
                const blockEnd = b.endDate.split('T')[0];
                return dayStr >= blockStart && dayStr <= blockEnd;
              });

              return (
                <button
                  key={i}
                  onClick={() => setSelectedDate(calDay)}
                  className={`relative p-2 rounded-lg text-center transition-all cursor-pointer min-h-[60px] ${
                    isSelected
                      ? 'bg-accent text-primary ring-2 ring-accent/30'
                      : hasBlocks
                        ? 'bg-red-500/[0.08] hover:bg-red-500/[0.12]'
                        : isCurrentMonth
                          ? 'hover:bg-white/[0.04]'
                          : 'opacity-30'
                  } ${isPast && !isSelected ? 'opacity-50' : ''}`}
                >
                  <div className={`text-xs font-medium ${isSelected ? 'text-primary' : hasBlocks ? 'text-red-400' : 'text-slate-300'}`}>
                    {format(calDay, 'd')}
                  </div>
                  {(hasSlots || hasBlocks) && (
                    <div className="mt-1">
                      {hasBlocks && (
                        <div className={`text-[8px] font-bold ${isSelected ? 'text-primary/70' : 'text-red-400'}`}>
                          BLOCKED
                        </div>
                      )}
                      {hasSlots && (
                        <div className={`text-[9px] font-medium ${isSelected ? 'text-primary/80' : 'text-accent'}`}>
                          {daySlots.length} slots
                        </div>
                      )}
                      {bookedSlots > 0 && (
                        <div className={`text-[9px] ${isSelected ? 'text-primary/60' : 'text-orange-500'}`}>
                          {bookedSlots} booked
                        </div>
                      )}
                      {totalBookings > 0 && totalBookings !== bookedSlots && (
                        <div className={`text-[8px] ${isSelected ? 'text-primary/50' : 'text-slate-500'}`}>
                          {totalBookings} total
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
