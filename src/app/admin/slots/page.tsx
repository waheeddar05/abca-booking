'use client';

import { useState, useEffect, useCallback } from 'react';
import { format, addDays, parseISO, eachDayOfInterval, getDay } from 'date-fns';
import {
  Clock, Loader2, Trash2, ShieldBan, Ban, AlertTriangle,
  CalendarRange, Repeat, CalendarClock, CheckCircle2, Info, Pencil, X,
} from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';

// ─── Types ───────────────────────────────────────────────
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
  recurringDays: number[];
  machineIds: string[];
  appliesTo: string;
}

type TabId = 'block' | 'active';
type ScheduleType = 'dateRange' | 'recurring';

const MACHINES = [
  { id: 'GRAVITY', label: 'Gravity Cricket', sub: 'Leather Ball', image: '/images/leathermachine.jpeg' },
  { id: 'YANTRA', label: 'Yantra Premium', sub: 'Leather Ball', image: '/images/yantra-machine.jpeg' },
  { id: 'LEVERAGE_INDOOR', label: 'Leverage Tennis', sub: 'Indoor', image: '/images/tennismachine.jpeg' },
  { id: 'LEVERAGE_OUTDOOR', label: 'Leverage Tennis', sub: 'Outdoor', image: '/images/tennismachine.jpeg' },
];

const WEEKDAYS = [
  { key: 1, label: 'Mon' },
  { key: 2, label: 'Tue' },
  { key: 3, label: 'Wed' },
  { key: 4, label: 'Thu' },
  { key: 5, label: 'Fri' },
  { key: 6, label: 'Sat' },
  { key: 0, label: 'Sun' },
];

// ─── Helpers ─────────────────────────────────────────────
const getMachineIdLabel = (id: string | null) => {
  if (!id) return null;
  return MACHINES.find(m => m.id === id)?.label || id;
};

const formatBlockTime = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  // Convert UTC to IST (UTC + 5:30)
  const utcMs = d.getTime();
  const istMs = utcMs + (5 * 60 + 30) * 60 * 1000;
  const istDate = new Date(istMs);
  const h = istDate.getUTCHours().toString().padStart(2, '0');
  const m = istDate.getUTCMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
};

// ─── Component ───────────────────────────────────────────
export default function SlotManagement() {
  const [activeTab, setActiveTab] = useState<TabId>('block');
  const [message, setMessage] = useState({ text: '', type: '' });

  // Block form state
  const [scheduleType, setScheduleType] = useState<ScheduleType>('dateRange');
  const [startDate, setStartDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [recurringDays, setRecurringDays] = useState<number[]>([]);
  const [isFullDay, setIsFullDay] = useState(true);
  const [startTime, setStartTime] = useState('07:00');
  const [endTime, setEndTime] = useState('22:30');
  const [selectedMachines, setSelectedMachines] = useState<string[]>([]);
  const [allMachines, setAllMachines] = useState(true);
  const [reason, setReason] = useState('');
  const [appliesTo, setAppliesTo] = useState<'ALL' | 'SPECIAL' | 'NON_SPECIAL'>('ALL');
  const [blockLoading, setBlockLoading] = useState(false);

  // Active blocks state
  const [blockedSlots, setBlockedSlots] = useState<BlockedSlot[]>([]);
  const [blockedLoading, setBlockedLoading] = useState(false);
  const [unblockId, setUnblockId] = useState<string | null>(null);
  const [editingBlock, setEditingBlock] = useState<BlockedSlot | null>(null);
  const [editForm, setEditForm] = useState({ startDate: '', endDate: '', startTime: '', endTime: '', isFullDay: true, machineId: '' as string | null, reason: '', appliesTo: 'ALL' as string });
  const [editLoading, setEditLoading] = useState(false);

  const todayStr = format(new Date(), 'yyyy-MM-dd');

  // ─── Fetch blocked slots ────────────────────────────────
  const fetchBlockedSlots = useCallback(async () => {
    setBlockedLoading(true);
    try {
      const res = await fetch('/api/admin/slots/block');
      if (res.ok) setBlockedSlots(await res.json());
    } catch {
      // silently fail
    } finally {
      setBlockedLoading(false);
    }
  }, []);

  useEffect(() => { fetchBlockedSlots(); }, [fetchBlockedSlots]);

  // ─── Auto-dismiss messages ──────────────────────────────
  useEffect(() => {
    if (message.text) {
      const t = setTimeout(() => setMessage({ text: '', type: '' }), 5000);
      return () => clearTimeout(t);
    }
  }, [message]);

  // ─── Toggle machine selection ───────────────────────────
  const toggleMachine = (id: string) => {
    setSelectedMachines(prev =>
      prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]
    );
  };

  const toggleRecurringDay = (day: number) => {
    setRecurringDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  };

  // ─── Reset form ─────────────────────────────────────────
  const resetForm = () => {
    setScheduleType('dateRange');
    setStartDate(format(new Date(), 'yyyy-MM-dd'));
    setEndDate(format(new Date(), 'yyyy-MM-dd'));
    setRecurringDays([]);
    setIsFullDay(true);
    setStartTime('07:00');
    setEndTime('22:30');
    setSelectedMachines([]);
    setAllMachines(true);
    setReason('');
    setAppliesTo('ALL');
  };

  // ─── Build list of dates to block ───────────────────────
  const getDatesToBlock = (): string[] => {
    if (scheduleType === 'dateRange') {
      // For date range, it's a single block entry (API handles the range)
      return [];
    }
    // Recurring: find all matching days in the date range
    if (recurringDays.length === 0) return [];
    try {
      const days = eachDayOfInterval({
        start: parseISO(startDate),
        end: parseISO(endDate),
      });
      return days
        .filter(d => recurringDays.includes(getDay(d)))
        .map(d => format(d, 'yyyy-MM-dd'));
    } catch {
      return [];
    }
  };

  // ─── Submit block ───────────────────────────────────────
  const handleBlock = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validations
    if (startDate < todayStr) {
      setMessage({ text: 'Start date cannot be in the past', type: 'error' });
      return;
    }
    if (endDate < startDate) {
      setMessage({ text: 'End date must be on or after start date', type: 'error' });
      return;
    }
    if (scheduleType === 'recurring' && recurringDays.length === 0) {
      setMessage({ text: 'Select at least one day of the week', type: 'error' });
      return;
    }
    if (!isFullDay && !startTime) {
      setMessage({ text: 'Start time is required', type: 'error' });
      return;
    }
    if (!isFullDay && !endTime) {
      setMessage({ text: 'End time is required', type: 'error' });
      return;
    }

    const machineIdsToSend = allMachines ? [] : selectedMachines;

    setBlockLoading(true);
    setMessage({ text: '', type: '' });

    try {
      // Build a single block request
      const body: Record<string, unknown> = {
        startDate,
        endDate,
        reason: reason || null,
        appliesTo,
      };
      if (!isFullDay) {
        body.startTime = startTime;
        body.endTime = endTime;
      }
      if (machineIdsToSend.length > 0) {
        body.machineIds = machineIdsToSend;
      }

      if (scheduleType === 'recurring') {
        const dates = getDatesToBlock();
        if (dates.length === 0) {
          setMessage({ text: 'No matching days found in the selected range', type: 'error' });
          setBlockLoading(false);
          return;
        }
        body.recurringDays = recurringDays;
      }

      const res = await fetch('/api/admin/slots/block', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (res.ok) {
        const parts = ['Block created successfully'];
        if (data.cancelledBookingsCount > 0) parts.push(`${data.cancelledBookingsCount} booking(s) cancelled`);
        setMessage({ text: parts.join('. '), type: 'success' });
      } else {
        setMessage({ text: data.error || 'Failed to block slots', type: 'error' });
      }

      resetForm();
      fetchBlockedSlots();
    } catch {
      setMessage({ text: 'Failed to block slots', type: 'error' });
    } finally {
      setBlockLoading(false);
    }
  };

  // ─── Unblock ────────────────────────────────────────────
  const handleUnblockClick = (id: string) => {
    setUnblockId(id);
  };

  const handleUnblockConfirm = async () => {
    const id = unblockId;
    if (!id) return;
    setUnblockId(null);
    try {
      const res = await fetch(`/api/admin/slots/block?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        setMessage({ text: 'Block removed', type: 'success' });
        fetchBlockedSlots();
      } else {
        const data = await res.json();
        setMessage({ text: data.error || 'Failed to remove block', type: 'error' });
      }
    } catch {
      setMessage({ text: 'Failed to remove block', type: 'error' });
    }
  };

  // ─── Edit block ─────────────────────────────────────────
  const startEditBlock = (block: BlockedSlot) => {
    setEditingBlock(block);
    setEditForm({
      startDate: block.startDate.split('T')[0],
      endDate: block.endDate.split('T')[0],
      startTime: formatBlockTime(block.startTime) || '07:00',
      endTime: formatBlockTime(block.endTime) || '22:30',
      isFullDay: !block.startTime,
      machineId: block.machineId,
      reason: block.reason || '',
      appliesTo: block.appliesTo || 'ALL',
    });
  };

  const handleEditSave = async () => {
    if (!editingBlock) return;
    setEditLoading(true);
    try {
      const body: Record<string, unknown> = {
        id: editingBlock.id,
        startDate: editForm.startDate,
        endDate: editForm.endDate,
        reason: editForm.reason || null,
        appliesTo: editForm.appliesTo,
      };
      if (!editForm.isFullDay) {
        body.startTime = editForm.startTime;
        body.endTime = editForm.endTime;
      } else {
        body.startTime = null;
        body.endTime = null;
      }
      body.machineId = editForm.machineId || null;

      const res = await fetch('/api/admin/slots/block', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setMessage({ text: 'Block updated successfully', type: 'success' });
        setEditingBlock(null);
        fetchBlockedSlots();
      } else {
        const data = await res.json();
        setMessage({ text: data.error || 'Failed to update block', type: 'error' });
      }
    } catch {
      setMessage({ text: 'Failed to update block', type: 'error' });
    } finally {
      setEditLoading(false);
    }
  };

  // ─── Preview info for recurring ─────────────────────────
  const recurringPreviewCount = scheduleType === 'recurring' ? getDatesToBlock().length : 0;

  return (
    <div>
      {/* Header */}
      <AdminPageHeader icon={Clock} title="Slot Management" description="Block time slots & manage availability" />

      {/* Tabs */}
      <div className="flex gap-1 mb-5 bg-white/[0.03] p-1 rounded-xl border border-white/[0.06]">
        {([
          { id: 'block' as TabId, label: 'Block Slots', icon: ShieldBan },
          { id: 'active' as TabId, label: 'Active Blocks', icon: Ban, count: blockedSlots.length },
        ]).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all cursor-pointer ${activeTab === tab.id
                ? 'bg-white/[0.08] text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-300'
              }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${activeTab === tab.id ? 'bg-red-500/20 text-red-400' : 'bg-white/[0.06] text-slate-500'
                }`}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Message Toast */}
      {message.text && (
        <div className={`mb-4 px-4 py-3 rounded-xl text-sm flex items-center gap-2 ${message.type === 'success'
            ? 'bg-green-500/10 border border-green-500/20 text-green-400'
            : 'bg-red-500/10 border border-red-500/20 text-red-400'
          }`}>
          {message.type === 'success' ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <AlertTriangle className="w-4 h-4 flex-shrink-0" />}
          {message.text}
        </div>
      )}

      {/* ════════════════════════════════════════════════════ */}
      {/* BLOCK SLOTS TAB                                     */}
      {/* ════════════════════════════════════════════════════ */}
      {activeTab === 'block' && (
        <form onSubmit={handleBlock} className="space-y-5">

          {/* Warning Banner */}
          <div className="px-3.5 py-2.5 bg-amber-500/8 border border-amber-500/15 rounded-xl flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
            <p className="text-[11px] text-amber-400/90 leading-relaxed">
              Blocking will automatically cancel any existing bookings in the selected range. Affected users will be notified.
            </p>
          </div>

          {/* ── Section 1: Schedule Type ────────────────── */}
          <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] p-4">
            <div className="flex items-center gap-2 mb-3">
              <CalendarClock className="w-4 h-4 text-accent" />
              <h3 className="text-xs font-semibold text-white uppercase tracking-wider">Schedule</h3>
            </div>

            {/* Toggle: Date Range / Recurring */}
            <div className="flex gap-1 mb-4 bg-white/[0.03] p-1 rounded-lg">
              <button
                type="button"
                onClick={() => setScheduleType('dateRange')}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-all cursor-pointer ${scheduleType === 'dateRange'
                    ? 'bg-accent/15 text-accent'
                    : 'text-slate-400 hover:text-slate-300'
                  }`}
              >
                <CalendarRange className="w-3.5 h-3.5" />
                Date Range
              </button>
              <button
                type="button"
                onClick={() => setScheduleType('recurring')}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-all cursor-pointer ${scheduleType === 'recurring'
                    ? 'bg-accent/15 text-accent'
                    : 'text-slate-400 hover:text-slate-300'
                  }`}
              >
                <Repeat className="w-3.5 h-3.5" />
                Recurring Days
              </button>
            </div>

            {/* Date Inputs */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-medium text-slate-500 mb-1 uppercase tracking-wider">
                  {scheduleType === 'recurring' ? 'From' : 'Start Date'}
                </label>
                <input
                  type="date"
                  value={startDate}
                  min={todayStr}
                  onChange={e => setStartDate(e.target.value)}
                  required
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20"
                />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-slate-500 mb-1 uppercase tracking-wider">
                  {scheduleType === 'recurring' ? 'Until' : 'End Date'}
                </label>
                <input
                  type="date"
                  value={endDate}
                  min={startDate || todayStr}
                  onChange={e => setEndDate(e.target.value)}
                  required
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20"
                />
              </div>
            </div>

            {/* Recurring Day Picker */}
            {scheduleType === 'recurring' && (
              <div className="mt-4">
                <label className="block text-[10px] font-medium text-slate-500 mb-2 uppercase tracking-wider">
                  Repeat on
                </label>
                <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5">
                  {WEEKDAYS.map(day => (
                    <button
                      key={day.key}
                      type="button"
                      onClick={() => toggleRecurringDay(day.key)}
                      className={`py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${recurringDays.includes(day.key)
                          ? 'bg-accent/20 text-accent ring-1 ring-accent/30'
                          : 'bg-white/[0.04] text-slate-400 hover:bg-white/[0.06]'
                        }`}
                    >
                      {day.label}
                    </button>
                  ))}
                </div>
                {recurringPreviewCount > 0 && (
                  <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-accent/80">
                    <Info className="w-3 h-3" />
                    {recurringPreviewCount} day{recurringPreviewCount > 1 ? 's' : ''} will be blocked
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Section 2: Time ─────────────────────────── */}
          <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-accent" />
                <h3 className="text-xs font-semibold text-white uppercase tracking-wider">Time</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsFullDay(!isFullDay)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${isFullDay
                    ? 'bg-accent/15 text-accent'
                    : 'bg-white/[0.04] text-slate-400 hover:bg-white/[0.06]'
                  }`}
              >
                {isFullDay ? 'Full Day' : 'Custom Hours'}
              </button>
            </div>

            {isFullDay ? (
              <p className="text-xs text-slate-500">All slots for the entire day will be blocked.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-medium text-slate-500 mb-1 uppercase tracking-wider">From</label>
                  <input
                    type="time"
                    value={startTime}
                    onChange={e => setStartTime(e.target.value)}
                    required={!isFullDay}
                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-slate-500 mb-1 uppercase tracking-wider">To</label>
                  <input
                    type="time"
                    value={endTime}
                    onChange={e => setEndTime(e.target.value)}
                    required={!isFullDay}
                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20"
                  />
                </div>
              </div>
            )}
          </div>

          {/* ── Section 3: Machines ─────────────────────── */}
          <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <ShieldBan className="w-4 h-4 text-accent" />
                <h3 className="text-xs font-semibold text-white uppercase tracking-wider">Machines</h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setAllMachines(!allMachines);
                  if (!allMachines) setSelectedMachines([]);
                }}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${allMachines
                    ? 'bg-red-500/15 text-red-400'
                    : 'bg-white/[0.04] text-slate-400 hover:bg-white/[0.06]'
                  }`}
              >
                {allMachines ? 'All Machines' : 'Select Specific'}
              </button>
            </div>

            {allMachines ? (
              <p className="text-xs text-slate-500">All machines will be blocked for the selected period.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {MACHINES.map(m => {
                  const isSelected = selectedMachines.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => toggleMachine(m.id)}
                      className={`flex items-center gap-2.5 p-2.5 rounded-xl transition-all cursor-pointer text-left ${isSelected
                          ? 'bg-red-500/10 ring-1.5 ring-red-500/40'
                          : 'bg-white/[0.03] border border-white/[0.06] hover:border-white/[0.12]'
                        }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={m.image}
                        alt={m.label}
                        className="w-9 h-9 rounded-lg object-cover flex-shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <span className={`text-[11px] font-bold block truncate ${isSelected ? 'text-red-400' : 'text-slate-300'}`}>
                          {m.label}
                        </span>
                        <span className={`text-[9px] ${isSelected ? 'text-red-400/60' : 'text-slate-600'}`}>
                          {m.sub}
                        </span>
                      </div>
                      <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${isSelected ? 'bg-red-500 border-red-500' : 'border-slate-600'
                        }`}>
                        {isSelected && <span className="text-white text-[8px] font-bold">✓</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Section 4: Reason ───────────────────────── */}
          <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] p-4">
            <label className="block text-[10px] font-medium text-slate-500 mb-1.5 uppercase tracking-wider">
              Reason <span className="text-slate-600 normal-case">(optional)</span>
            </label>
            <input
              type="text"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="e.g., Pitch maintenance, Machine repair, Holiday..."
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 placeholder:text-slate-600"
            />
          </div>

          {/* ── Section 5: Apply Block To ─────────────── */}
          <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] p-4">
            <label className="block text-[10px] font-medium text-slate-500 mb-2 uppercase tracking-wider">
              Apply Block To
            </label>
            <div className="flex gap-2 flex-wrap">
              {[
                { value: 'ALL' as const, label: 'All Users' },
                { value: 'NON_SPECIAL' as const, label: 'Only Non-Special Users' },
                { value: 'SPECIAL' as const, label: 'Only Special Users' },
              ].map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setAppliesTo(opt.value)}
                  className={`px-3 py-2 text-xs font-medium rounded-lg border transition-all cursor-pointer ${
                    appliesTo === opt.value
                      ? 'bg-accent/15 text-accent border-accent/30'
                      : 'bg-white/[0.03] text-slate-400 border-white/[0.08] hover:bg-white/[0.06]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* ── Actions ────────────────────────────────── */}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={blockLoading || (!allMachines && selectedMachines.length === 0)}
              className="flex-1 inline-flex items-center justify-center gap-2 bg-red-500/15 hover:bg-red-500/25 text-red-400 border border-red-500/25 px-5 py-3 rounded-xl text-sm font-semibold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {blockLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ShieldBan className="w-4 h-4" />
              )}
              {blockLoading ? 'Blocking...' : 'Block Slots'}
            </button>
            <button
              type="button"
              onClick={resetForm}
              className="px-5 py-3 bg-white/[0.04] text-slate-400 rounded-xl text-sm font-medium hover:bg-white/[0.08] transition-colors cursor-pointer"
            >
              Reset
            </button>
          </div>
        </form>
      )}

      {/* ════════════════════════════════════════════════════ */}
      {/* ACTIVE BLOCKS TAB                                   */}
      {/* ════════════════════════════════════════════════════ */}
      {activeTab === 'active' && (
        <div>
          {blockedLoading ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin mb-2" />
              <span className="text-sm">Loading blocks...</span>
            </div>
          ) : blockedSlots.length === 0 ? (
            <div className="text-center py-16">
              <div className="w-14 h-14 rounded-full bg-white/[0.04] flex items-center justify-center mx-auto mb-3">
                <Ban className="w-6 h-6 text-slate-600" />
              </div>
              <p className="text-sm text-slate-400 mb-1">No active blocks</p>
              <p className="text-xs text-slate-600">All slots are currently available for booking.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {blockedSlots.map(block => {
                const sameDay = block.startDate.split('T')[0] === block.endDate.split('T')[0];
                const startStr = format(parseISO(block.startDate), 'MMM d, yyyy');
                const endStr = format(parseISO(block.endDate), 'MMM d, yyyy');
                const st = formatBlockTime(block.startTime);
                const et = formatBlockTime(block.endTime);
                const isFullDay = !block.startTime;
                const machineLabel = block.machineId ? getMachineIdLabel(block.machineId) : null;
                const hasMultipleMachines = block.machineIds && block.machineIds.length > 0;
                const machineLabels = hasMultipleMachines
                  ? block.machineIds.map(id => getMachineIdLabel(id)).filter(Boolean)
                  : [];
                const hasRecurringDays = block.recurringDays && block.recurringDays.length > 0;
                const recurringDayLabels = hasRecurringDays
                  ? block.recurringDays.map(d => WEEKDAYS.find(w => w.key === d)?.label).filter(Boolean)
                  : [];

                return (
                  <div
                    key={block.id}
                    className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 flex items-start gap-3"
                  >
                    {/* Left color bar */}
                    <div className="w-1 self-stretch rounded-full bg-red-500/40 flex-shrink-0" />

                    <div className="flex-1 min-w-0">
                      {/* Date line */}
                      <div className="flex flex-wrap items-center gap-2 mb-1.5">
                        <span className="text-sm font-semibold text-white">
                          {sameDay ? startStr : `${startStr} — ${endStr}`}
                        </span>
                        {isFullDay ? (
                          <span className="text-[10px] font-semibold text-red-400 bg-red-500/10 px-2 py-0.5 rounded-md">
                            Full Day
                          </span>
                        ) : st && et ? (
                          <span className="text-[10px] font-medium text-slate-400 bg-white/[0.04] px-2 py-0.5 rounded-md">
                            {st} — {et}
                          </span>
                        ) : null}
                      </div>

                      {/* Recurring days */}
                      {hasRecurringDays && (
                        <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                          <Repeat className="w-3 h-3 text-accent/60" />
                          <span className="text-[10px] font-medium text-accent/80">
                            Every {recurringDayLabels.join(', ')}
                          </span>
                        </div>
                      )}

                      {/* Tags line */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        {hasMultipleMachines ? (
                          machineLabels.map((label, idx) => (
                            <span key={idx} className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-400">
                              {label}
                            </span>
                          ))
                        ) : machineLabel ? (
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-400">
                            {machineLabel}
                          </span>
                        ) : (
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-red-500/10 text-red-400">
                            All Machines
                          </span>
                        )}
                        {block.reason && (
                          <span className="text-[10px] text-slate-500 italic truncate">
                            {block.reason}
                          </span>
                        )}
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-md ${
                          block.appliesTo === 'SPECIAL' ? 'bg-purple-500/10 text-purple-400' :
                          block.appliesTo === 'NON_SPECIAL' ? 'bg-orange-500/10 text-orange-400' :
                          'bg-slate-500/10 text-slate-400'
                        }`}>
                          {block.appliesTo === 'SPECIAL' ? 'Special Users Only' :
                           block.appliesTo === 'NON_SPECIAL' ? 'Non-Special Users Only' :
                           'All Users'}
                        </span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => startEditBlock(block)}
                        className="p-2 text-slate-600 hover:text-accent hover:bg-accent/10 rounded-lg transition-colors cursor-pointer"
                        title="Edit block"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleUnblockClick(block.id)}
                        className="p-2 text-slate-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer"
                        title="Remove block"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Edit Block Modal */}
      {editingBlock && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setEditingBlock(null)} />
          <div className="relative bg-[#0f1729] border border-white/[0.08] rounded-2xl p-5 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-white">Edit Block</h3>
              <button onClick={() => setEditingBlock(null)} className="p-1.5 hover:bg-white/[0.06] rounded-lg cursor-pointer">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>

            <div className="space-y-3">
              {/* Date Range */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-medium text-slate-500 mb-1 uppercase tracking-wider">Start Date</label>
                  <input type="date" value={editForm.startDate} onChange={e => setEditForm(f => ({ ...f, startDate: e.target.value }))}
                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent/50" />
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-slate-500 mb-1 uppercase tracking-wider">End Date</label>
                  <input type="date" value={editForm.endDate} onChange={e => setEditForm(f => ({ ...f, endDate: e.target.value }))}
                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent/50" />
                </div>
              </div>

              {/* Time */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Time</label>
                  <button type="button" onClick={() => setEditForm(f => ({ ...f, isFullDay: !f.isFullDay }))}
                    className={`px-3 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${editForm.isFullDay ? 'bg-accent/15 text-accent' : 'bg-white/[0.04] text-slate-400'}`}>
                    {editForm.isFullDay ? 'Full Day' : 'Custom Hours'}
                  </button>
                </div>
                {!editForm.isFullDay && (
                  <div className="grid grid-cols-2 gap-3">
                    <input type="time" value={editForm.startTime} onChange={e => setEditForm(f => ({ ...f, startTime: e.target.value }))}
                      className="bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent/50" />
                    <input type="time" value={editForm.endTime} onChange={e => setEditForm(f => ({ ...f, endTime: e.target.value }))}
                      className="bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent/50" />
                  </div>
                )}
              </div>

              {/* Machine */}
              <div>
                <label className="block text-[10px] font-medium text-slate-500 mb-1 uppercase tracking-wider">Machine</label>
                <select value={editForm.machineId || ''} onChange={e => setEditForm(f => ({ ...f, machineId: e.target.value || null }))}
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent/50">
                  <option value="">All Machines</option>
                  {MACHINES.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </div>

              {/* Reason */}
              <div>
                <label className="block text-[10px] font-medium text-slate-500 mb-1 uppercase tracking-wider">Reason</label>
                <input type="text" value={editForm.reason} onChange={e => setEditForm(f => ({ ...f, reason: e.target.value }))}
                  placeholder="e.g., Pitch maintenance..."
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent/50 placeholder:text-slate-600" />
              </div>

              {/* Apply Block To */}
              <div>
                <label className="block text-[10px] font-medium text-slate-500 mb-2 uppercase tracking-wider">Apply Block To</label>
                <div className="flex gap-2 flex-wrap">
                  {[
                    { value: 'ALL', label: 'All Users' },
                    { value: 'NON_SPECIAL', label: 'Non-Special Only' },
                    { value: 'SPECIAL', label: 'Special Only' },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setEditForm(f => ({ ...f, appliesTo: opt.value }))}
                      className={`px-2.5 py-1.5 text-[11px] font-medium rounded-lg border transition-all cursor-pointer ${
                        editForm.appliesTo === opt.value
                          ? 'bg-accent/15 text-accent border-accent/30'
                          : 'bg-white/[0.03] text-slate-400 border-white/[0.08] hover:bg-white/[0.06]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-2 mt-5">
              <button onClick={handleEditSave} disabled={editLoading}
                className="flex-1 inline-flex items-center justify-center gap-2 bg-accent/15 hover:bg-accent/25 text-accent border border-accent/25 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all cursor-pointer disabled:opacity-40">
                {editLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {editLoading ? 'Saving...' : 'Save Changes'}
              </button>
              <button onClick={() => setEditingBlock(null)}
                className="px-4 py-2.5 bg-white/[0.04] text-slate-400 rounded-xl text-sm font-medium hover:bg-white/[0.08] transition-colors cursor-pointer">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!unblockId}
        title="Remove Block"
        message="Remove this block? Previously cancelled bookings will not be restored."
        confirmLabel="Remove"
        variant="danger"
        onConfirm={handleUnblockConfirm}
        onCancel={() => setUnblockId(null)}
      />
    </div>
  );
}
