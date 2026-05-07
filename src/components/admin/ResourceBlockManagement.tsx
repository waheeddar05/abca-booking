'use client';

/**
 * Slot blocking UI for RESOURCE_BASED centers (Toplay et al.).
 *
 * Sister component to the legacy MACHINE_PITCH `SlotManagementLegacy`
 * form in /admin/slots/page.tsx. The legacy form is hardcoded around
 * the four ABCA enum machines + ball/pitch types; this one targets
 * resource-based bookings via three new BlockedSlot axes:
 *
 *   - machineRowIds  Machine rows (e.g. "Yantra 1", "Leverage 2")
 *   - resourceIds    Resource rows (specific nets/wickets/courts)
 *   - categories     BookingCategory enum (block all SIDEARM, etc.)
 *
 * Empty arrays = "no filter on that axis". A block with no axes set
 * at all is a catchall — every booking in the time window is blocked.
 */

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import {
  Ban, Loader2, Plus, Trash2, AlertTriangle, ShieldBan, Calendar,
} from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useCenter } from '@/lib/center-context';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_NUMBERS = [0, 1, 2, 3, 4, 5, 6];

const CATEGORY_LABELS: Record<string, string> = {
  MACHINE: 'Bowling Machine',
  SIDEARM: 'Sidearm',
  COACHING: 'Personal Coaching',
  NET: 'Cricket Nets',
  FULL_COURT: 'Full Indoor Court',
  CORPORATE_BATCH: 'Corporate Batch',
};

const ALL_CATEGORIES = ['MACHINE', 'SIDEARM', 'COACHING', 'NET', 'FULL_COURT', 'CORPORATE_BATCH'] as const;

interface CenterMachine {
  id: string;
  name: string;
  shortName?: string | null;
  isActive: boolean;
  machineType: { code: string; name: string };
}

interface CenterResource {
  id: string;
  name: string;
  type: string;
  category: string;
  isActive: boolean;
}

interface BlockedSlotRow {
  id: string;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  recurringDays: number[];
  reason: string | null;
  appliesTo: string;
  machineRowIds: string[];
  resourceIds: string[];
  categories: string[];
  // Legacy fields kept on the row for super-admin debugging — not
  // editable from this UI.
  machineId: string | null;
  machineIds: string[];
  machineType: string | null;
  pitchType: string | null;
}

export function ResourceBlockManagement() {
  const toast = useToast();
  const { currentCenter } = useCenter();

  const [machines, setMachines] = useState<CenterMachine[]>([]);
  const [resources, setResources] = useState<CenterResource[]>([]);
  const [blocks, setBlocks] = useState<BlockedSlotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Form state
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [recurringDays, setRecurringDays] = useState<number[]>([]);
  const [pickedMachineIds, setPickedMachineIds] = useState<string[]>([]);
  const [pickedResourceIds, setPickedResourceIds] = useState<string[]>([]);
  const [pickedCategories, setPickedCategories] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [appliesTo, setAppliesTo] = useState<'ALL' | 'SPECIAL' | 'NON_SPECIAL'>('ALL');

  const fetchAll = async () => {
    if (!currentCenter) return;
    setLoading(true);
    try {
      const [machinesRes, blocksRes] = await Promise.all([
        fetch(`/api/centers/${currentCenter.id}/machines`).then((r) => (r.ok ? r.json() : [])),
        fetch('/api/admin/slots/block').then((r) => (r.ok ? r.json() : [])),
      ]);
      setMachines(Array.isArray(machinesRes) ? machinesRes : []);
      setBlocks(Array.isArray(blocksRes) ? blocksRes : []);
      // Resources come from a dedicated public endpoint at the center
      // page; for the slot blocker we only need active rows. Reuse the
      // existing super-admin endpoint (gated upstream).
      const r = await fetch(`/api/admin/centers/${currentCenter.id}/resources`);
      if (r.ok) {
        const rows = await r.json();
        setResources((Array.isArray(rows) ? rows : []).filter((x: CenterResource) => x.isActive));
      }
    } catch (err) {
      console.error('[ResourceBlocks] load failed:', err);
      toast.error('Failed to load blocks');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCenter?.id]);

  const resetForm = () => {
    setStartDate('');
    setEndDate('');
    setStartTime('');
    setEndTime('');
    setRecurringDays([]);
    setPickedMachineIds([]);
    setPickedResourceIds([]);
    setPickedCategories([]);
    setReason('');
    setAppliesTo('ALL');
  };

  const submit = async () => {
    if (!startDate) {
      toast.error('Pick a start date');
      return;
    }
    const effectiveEnd = endDate || startDate;
    if (effectiveEnd < startDate) {
      toast.error('End date must be on or after start date');
      return;
    }
    if ((startTime && !endTime) || (!startTime && endTime)) {
      toast.error('Provide both start and end time, or leave both empty');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/admin/slots/block', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate,
          endDate: effectiveEnd,
          startTime: startTime || null,
          endTime: endTime || null,
          recurringDays,
          machineRowIds: pickedMachineIds,
          resourceIds: pickedResourceIds,
          categories: pickedCategories,
          reason: reason || null,
          appliesTo,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create block');
      }
      toast.success('Block created');
      resetForm();
      await fetchAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create block');
    } finally {
      setCreating(false);
    }
  };

  const deleteBlock = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/slots/block?id=${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to remove');
      }
      toast.success('Block removed');
      await fetchAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove block');
    } finally {
      setConfirmDeleteId(null);
    }
  };

  const toggleInArray = <T,>(arr: T[], item: T): T[] =>
    arr.includes(item) ? arr.filter((x) => x !== item) : [...arr, item];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-500">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ─── Add new block ──────────────────────────── */}
      <div className="bg-white/[0.03] border border-white/[0.07] rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <ShieldBan className="w-4 h-4 text-accent" />
          <h3 className="text-xs font-bold text-white uppercase tracking-wider">Add Block</h3>
        </div>
        <p className="text-[11px] text-slate-500 mb-4 leading-relaxed">
          Block bookings at this center for a date range. Leave time empty for an all-day
          block. Pick specific machines, resources, or categories to scope the block — empty
          axes mean &ldquo;no filter on that axis&rdquo;. A block with no axes set blocks every
          booking in the time window.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-[10px] font-medium text-slate-400 mb-1">Start date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full bg-white/[0.04] border border-white/[0.1] text-white rounded-lg px-2 py-2 text-xs outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="block text-[10px] font-medium text-slate-400 mb-1">End date (defaults to start)</label>
            <input
              type="date"
              value={endDate}
              min={startDate || undefined}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full bg-white/[0.04] border border-white/[0.1] text-white rounded-lg px-2 py-2 text-xs outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="block text-[10px] font-medium text-slate-400 mb-1">Start time (HH:MM, optional)</label>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full bg-white/[0.04] border border-white/[0.1] text-white rounded-lg px-2 py-2 text-xs outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="block text-[10px] font-medium text-slate-400 mb-1">End time</label>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full bg-white/[0.04] border border-white/[0.1] text-white rounded-lg px-2 py-2 text-xs outline-none focus:border-accent"
            />
          </div>
        </div>

        {/* Recurring days */}
        <div className="mb-4">
          <label className="block text-[10px] font-medium text-slate-400 mb-1.5 uppercase tracking-wider">
            Repeat on (optional)
          </label>
          <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5">
            {DAY_NUMBERS.map((day) => {
              const selected = recurringDays.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => setRecurringDays((prev) => toggleInArray(prev, day))}
                  className={`py-1.5 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                    selected
                      ? 'bg-accent/20 text-accent ring-1 ring-accent/30'
                      : 'bg-white/[0.04] text-slate-400 hover:bg-white/[0.06]'
                  }`}
                >
                  {DAY_LABELS[day]}
                </button>
              );
            })}
          </div>
          <p className="text-[10px] text-slate-500 mt-1.5">
            Empty = applies every day in the date range.
          </p>
        </div>

        {/* Categories */}
        <div className="mb-4">
          <label className="block text-[10px] font-medium text-slate-400 mb-1.5 uppercase tracking-wider">
            Categories (optional)
          </label>
          <div className="flex flex-wrap gap-1.5">
            {ALL_CATEGORIES.map((c) => {
              const selected = pickedCategories.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setPickedCategories((prev) => toggleInArray(prev, c))}
                  className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all cursor-pointer ${
                    selected
                      ? 'bg-accent/20 text-accent ring-1 ring-accent/30'
                      : 'bg-white/[0.04] text-slate-400 hover:bg-white/[0.06]'
                  }`}
                >
                  {CATEGORY_LABELS[c] ?? c}
                </button>
              );
            })}
          </div>
        </div>

        {/* Machines */}
        {machines.length > 0 && (
          <div className="mb-4">
            <label className="block text-[10px] font-medium text-slate-400 mb-1.5 uppercase tracking-wider">
              Machines (optional)
            </label>
            <div className="flex flex-wrap gap-1.5">
              {machines.filter((m) => m.isActive).map((m) => {
                const selected = pickedMachineIds.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setPickedMachineIds((prev) => toggleInArray(prev, m.id))}
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all cursor-pointer ${
                      selected
                        ? 'bg-accent/20 text-accent ring-1 ring-accent/30'
                        : 'bg-white/[0.04] text-slate-400 hover:bg-white/[0.06]'
                    }`}
                  >
                    {m.shortName ?? m.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Resources */}
        {resources.length > 0 && (
          <div className="mb-4">
            <label className="block text-[10px] font-medium text-slate-400 mb-1.5 uppercase tracking-wider">
              Resources (optional)
            </label>
            <div className="flex flex-wrap gap-1.5">
              {resources.map((r) => {
                const selected = pickedResourceIds.includes(r.id);
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setPickedResourceIds((prev) => toggleInArray(prev, r.id))}
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all cursor-pointer ${
                      selected
                        ? 'bg-accent/20 text-accent ring-1 ring-accent/30'
                        : 'bg-white/[0.04] text-slate-400 hover:bg-white/[0.06]'
                    }`}
                  >
                    {r.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Reason + audience + submit */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <div className="sm:col-span-2">
            <label className="block text-[10px] font-medium text-slate-400 mb-1">Reason (optional)</label>
            <input
              type="text"
              placeholder="e.g. Maintenance"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full bg-white/[0.04] border border-white/[0.1] text-white rounded-lg px-2 py-2 text-xs outline-none focus:border-accent placeholder:text-slate-600"
            />
          </div>
          <div>
            <label className="block text-[10px] font-medium text-slate-400 mb-1">Applies to</label>
            <select
              value={appliesTo}
              onChange={(e) => setAppliesTo(e.target.value as 'ALL' | 'SPECIAL' | 'NON_SPECIAL')}
              className="w-full bg-white/[0.04] border border-white/[0.1] text-white rounded-lg px-2 py-2 text-xs outline-none focus:border-accent"
            >
              <option value="ALL">All users</option>
              <option value="SPECIAL">Special users only</option>
              <option value="NON_SPECIAL">Non-special users only</option>
            </select>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            onClick={submit}
            disabled={creating || !startDate}
            className="flex items-center gap-2 px-4 py-2.5 bg-accent hover:bg-accent-light text-primary text-xs font-semibold rounded-lg transition-colors cursor-pointer disabled:opacity-50"
          >
            {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Create Block
          </button>
        </div>
      </div>

      {/* ─── Active blocks list ─────────────────────── */}
      <div className="bg-white/[0.03] border border-white/[0.07] rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Ban className="w-4 h-4 text-accent" />
          <h3 className="text-xs font-bold text-white uppercase tracking-wider">Active Blocks</h3>
        </div>
        {blocks.length === 0 ? (
          <p className="text-xs text-slate-500 italic py-6 text-center">No active blocks at this center.</p>
        ) : (
          <div className="space-y-2">
            {blocks.map((b) => {
              const dateStr =
                b.startDate.slice(0, 10) === b.endDate.slice(0, 10)
                  ? format(new Date(b.startDate), 'EEE, dd MMM yyyy')
                  : `${format(new Date(b.startDate), 'dd MMM')} → ${format(new Date(b.endDate), 'dd MMM yyyy')}`;
              const timeStr =
                b.startTime && b.endTime
                  ? `${new Date(b.startTime).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false })}–${new Date(b.endTime).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false })}`
                  : 'All day';

              const machineNames = b.machineRowIds
                .map((id) => machines.find((m) => m.id === id))
                .filter(Boolean)
                .map((m) => m!.shortName ?? m!.name);
              const resourceNames = b.resourceIds
                .map((id) => resources.find((r) => r.id === id))
                .filter(Boolean)
                .map((r) => r!.name);

              return (
                <div
                  key={b.id}
                  className="flex items-start justify-between gap-3 bg-white/[0.02] border border-white/[0.06] rounded-lg px-3 py-2.5"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="text-white font-semibold flex items-center gap-1.5">
                        <Calendar className="w-3 h-3 text-accent" /> {dateStr}
                      </span>
                      <span className="text-slate-400">{timeStr}</span>
                      {b.recurringDays.length > 0 && (
                        <span className="text-accent/80 px-1.5 py-0.5 rounded bg-accent/10">
                          {[...b.recurringDays].sort((a, b) => a - b).map((d) => DAY_LABELS[d]).join(' ')}
                        </span>
                      )}
                      {b.appliesTo !== 'ALL' && (
                        <span className="text-amber-400 px-1.5 py-0.5 rounded bg-amber-500/10">
                          {b.appliesTo}
                        </span>
                      )}
                    </div>
                    {(b.categories.length > 0 || machineNames.length > 0 || resourceNames.length > 0) && (
                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        {b.categories.map((c) => (
                          <span key={c} className="text-[10px] text-purple-300/80 px-1.5 py-0.5 rounded bg-purple-500/10">
                            {CATEGORY_LABELS[c] ?? c}
                          </span>
                        ))}
                        {machineNames.map((n) => (
                          <span key={`m-${n}`} className="text-[10px] text-cyan-300/80 px-1.5 py-0.5 rounded bg-cyan-500/10">
                            {n}
                          </span>
                        ))}
                        {resourceNames.map((n) => (
                          <span key={`r-${n}`} className="text-[10px] text-emerald-300/80 px-1.5 py-0.5 rounded bg-emerald-500/10">
                            {n}
                          </span>
                        ))}
                      </div>
                    )}
                    {b.reason && (
                      <p className="text-[11px] text-slate-400 mt-1.5">{b.reason}</p>
                    )}
                    {(b.machineId || b.machineIds.length > 0 || b.machineType || b.pitchType) && (
                      <p className="text-[10px] text-slate-600 mt-1 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        Includes legacy ABCA targeting (machineId / pitchType)
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => setConfirmDeleteId(b.id)}
                    className="flex-shrink-0 p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer"
                    title="Remove block"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Remove block?"
        message="The block is removed immediately. Existing bookings (if any) are not affected."
        confirmLabel="Remove"
        onCancel={() => setConfirmDeleteId(null)}
        onConfirm={() => confirmDeleteId && deleteBlock(confirmDeleteId)}
      />
    </div>
  );
}
