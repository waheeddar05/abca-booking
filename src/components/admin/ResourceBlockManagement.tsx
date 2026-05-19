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
 *
 * Layout mirrors ABCA's legacy panel:
 *   - Two tabs: "Block Slots" (create form) and "Active Blocks" (list).
 *   - Each active block has an Edit button that opens a modal pre-filled
 *     with every axis the block was created with, so the admin can
 *     change any of them without recreating the row.
 */

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import {
  Ban, Loader2, Plus, Trash2, AlertTriangle, ShieldBan, Calendar,
  Pencil, X, CheckCircle2, Clock,
} from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
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

// CORPORATE_BATCH intentionally omitted — the DB enum value stays
// for back-compat with historical bookings but the admin block-slot
// UI no longer offers it as a target category.
const ALL_CATEGORIES = ['MACHINE', 'SIDEARM', 'COACHING', 'NET', 'FULL_COURT'] as const;

type TabId = 'block' | 'active';

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
  /**
   * Partial cricket-net blocking. Null = block all indoor nets at this
   * window (legacy behaviour); positive integer = block that many out
   * of the pool. Surfaced in the UI as the "Number of Nets to Block"
   * input under the Cricket Nets category.
   */
  netCount: number | null;
  // Legacy fields kept on the row for super-admin debugging — not
  // editable from this UI.
  machineId: string | null;
  machineIds: string[];
  machineType: string | null;
  pitchType: string | null;
}

/**
 * User-facing label for each Resource.type. Mirrors CenterResourcesTab
 * so admins see the same surface name everywhere (the booking screen,
 * the resource manager, and this block-slot UI). Avoids drift between
 * "Indoor Net" / "Outdoor Net" admin labels and "Indoor Astro Turf /
 * Natural Turf / Cement Wicket" user labels.
 */
const RESOURCE_TYPE_LABELS: Record<string, string> = {
  NET: 'Indoor Astro Turf',
  TURF_WICKET: 'Natural Turf',
  CEMENT_WICKET: 'Cement Wicket',
  COURT: 'Full Court',
};

function resourceTypeLabel(type: string): string {
  return RESOURCE_TYPE_LABELS[type] ?? type;
}

interface EditForm {
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  isFullDay: boolean;
  recurringDays: number[];
  pickedCategories: string[];
  pickedMachineIds: string[];
  pickedResourceIds: string[];
  reason: string;
  appliesTo: 'ALL' | 'SPECIAL' | 'NON_SPECIAL';
  /** Empty string = "all nets" (legacy); a number = block that many. */
  netCount: string;
}

// Convert a stored TIME column (`1970-01-01THH:MM:00Z` UTC, stored at IST
// minus 5:30) back to the local HH:MM string the <input type="time">
// widget expects. The block API serialises both the create and update
// path through `new Date('1970-01-01TX:Y:00+05:30')`, so reversing the
// IST offset gives us the original string back.
function isoTimeToIstHHMM(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const istMs = d.getTime() + (5 * 60 + 30) * 60 * 1000;
  const ist = new Date(istMs);
  return `${ist.getUTCHours().toString().padStart(2, '0')}:${ist
    .getUTCMinutes()
    .toString()
    .padStart(2, '0')}`;
}

export function ResourceBlockManagement() {
  const toast = useToast();
  const { currentCenter } = useCenter();

  const [activeTab, setActiveTab] = useState<TabId>('block');
  const [machines, setMachines] = useState<CenterMachine[]>([]);
  const [resources, setResources] = useState<CenterResource[]>([]);
  const [blocks, setBlocks] = useState<BlockedSlotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Create-form state
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [isFullDay, setIsFullDay] = useState(true);
  const [recurringDays, setRecurringDays] = useState<number[]>([]);
  const [pickedMachineIds, setPickedMachineIds] = useState<string[]>([]);
  const [pickedResourceIds, setPickedResourceIds] = useState<string[]>([]);
  const [pickedCategories, setPickedCategories] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [appliesTo, setAppliesTo] = useState<'ALL' | 'SPECIAL' | 'NON_SPECIAL'>('ALL');
  // Partial cricket-net cap. Only meaningful when NET is in the picked
  // categories AND no specific resources are pinned — admin tells the
  // engine "reserve N nets, leave the rest bookable". Empty string =
  // "all nets" (the legacy / default behaviour).
  const [netCount, setNetCount] = useState<string>('');

  // Edit-modal state
  const [editingBlock, setEditingBlock] = useState<BlockedSlotRow | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({
    startDate: '',
    endDate: '',
    startTime: '07:00',
    endTime: '22:30',
    isFullDay: true,
    recurringDays: [],
    pickedCategories: [],
    pickedMachineIds: [],
    pickedResourceIds: [],
    reason: '',
    appliesTo: 'ALL',
    netCount: '',
  });
  const [editLoading, setEditLoading] = useState(false);

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
      // Resources come from the super-admin endpoint (gated upstream).
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
    setIsFullDay(true);
    setRecurringDays([]);
    setPickedMachineIds([]);
    setPickedResourceIds([]);
    setPickedCategories([]);
    setReason('');
    setAppliesTo('ALL');
    setNetCount('');
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
    if (!isFullDay) {
      if (!startTime || !endTime) {
        toast.error('Provide both start and end time, or choose Full Day');
        return;
      }
      if (endTime <= startTime) {
        toast.error('End time must be after start time');
        return;
      }
    }
    setCreating(true);
    try {
      // netCount only matters when NET is among the chosen categories
      // and the admin hasn't pinned specific resources. Empty string =
      // "block all nets" (engine treats null as the legacy all-nets
      // behaviour). Non-positive integers also fall back to "all".
      const netCountParsed =
        pickedCategories.includes('NET')
        && pickedResourceIds.length === 0
        && netCount.trim().length > 0
          ? Math.max(1, Math.floor(Number(netCount)))
          : null;

      const res = await fetch('/api/admin/slots/block', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate,
          endDate: effectiveEnd,
          startTime: isFullDay ? null : startTime,
          endTime: isFullDay ? null : endTime,
          recurringDays,
          machineRowIds: pickedMachineIds,
          resourceIds: pickedResourceIds,
          categories: pickedCategories,
          reason: reason || null,
          appliesTo,
          netCount: netCountParsed,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create block');
      }
      toast.success('Block created');
      resetForm();
      await fetchAll();
      setActiveTab('active');
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

  // ─── Edit handlers ──────────────────────────────────────
  const startEditBlock = (block: BlockedSlotRow) => {
    setEditingBlock(block);
    const st = isoTimeToIstHHMM(block.startTime);
    const et = isoTimeToIstHHMM(block.endTime);
    setEditForm({
      startDate: block.startDate.split('T')[0],
      endDate: block.endDate.split('T')[0],
      startTime: st || '07:00',
      endTime: et || '22:30',
      isFullDay: !block.startTime,
      recurringDays: block.recurringDays || [],
      pickedCategories: block.categories || [],
      pickedMachineIds: block.machineRowIds || [],
      pickedResourceIds: block.resourceIds || [],
      reason: block.reason || '',
      appliesTo: (block.appliesTo as 'ALL' | 'SPECIAL' | 'NON_SPECIAL') || 'ALL',
      netCount: block.netCount != null ? String(block.netCount) : '',
    });
  };

  const handleEditSave = async () => {
    if (!editingBlock) return;
    if (!editForm.startDate) {
      toast.error('Start date required');
      return;
    }
    const effectiveEnd = editForm.endDate || editForm.startDate;
    if (effectiveEnd < editForm.startDate) {
      toast.error('End date must be on or after start date');
      return;
    }
    if (!editForm.isFullDay) {
      if (!editForm.startTime || !editForm.endTime) {
        toast.error('Provide both start and end time, or choose Full Day');
        return;
      }
      if (editForm.endTime <= editForm.startTime) {
        toast.error('End time must be after start time');
        return;
      }
    }
    setEditLoading(true);
    try {
      const editNetCount =
        editForm.pickedCategories.includes('NET')
        && editForm.pickedResourceIds.length === 0
        && editForm.netCount.trim().length > 0
          ? Math.max(1, Math.floor(Number(editForm.netCount)))
          : null;

      const res = await fetch('/api/admin/slots/block', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingBlock.id,
          startDate: editForm.startDate,
          endDate: effectiveEnd,
          startTime: editForm.isFullDay ? null : editForm.startTime,
          endTime: editForm.isFullDay ? null : editForm.endTime,
          recurringDays: editForm.recurringDays,
          machineRowIds: editForm.pickedMachineIds,
          resourceIds: editForm.pickedResourceIds,
          categories: editForm.pickedCategories,
          reason: editForm.reason || null,
          appliesTo: editForm.appliesTo,
          netCount: editNetCount,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update block');
      }
      toast.success('Block updated');
      setEditingBlock(null);
      await fetchAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update block');
    } finally {
      setEditLoading(false);
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
    <div>
      <AdminPageHeader icon={Clock} title="Slot Management" description="Block time slots & manage availability" />

      {/* Tabs — same look as the ABCA legacy panel. */}
      <div className="flex gap-1 mb-5 bg-white/[0.03] p-1 rounded-xl border border-white/[0.06]">
        {([
          { id: 'block' as TabId, label: 'Block Slots', icon: ShieldBan },
          { id: 'active' as TabId, label: 'Active Blocks', icon: Ban, count: blocks.length },
        ]).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all cursor-pointer ${
              activeTab === tab.id
                ? 'bg-white/[0.08] text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-300'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                  activeTab === tab.id ? 'bg-red-500/20 text-red-400' : 'bg-white/[0.06] text-slate-500'
                }`}
              >
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ═══ Block Slots tab ═══ */}
      {activeTab === 'block' && (
        <div className="bg-white/[0.03] border border-white/[0.07] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <ShieldBan className="w-4 h-4 text-accent" />
            <h3 className="text-xs font-bold text-white uppercase tracking-wider">Add Block</h3>
          </div>
          <p className="text-[11px] text-slate-500 mb-4 leading-relaxed">
            Block bookings at this center for a date range. Leave time empty for an all-day block.
            Pick specific machines, resources, or categories to scope the block — empty axes mean
            &ldquo;no filter on that axis&rdquo;. A block with no axes set blocks every booking in
            the time window.
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
              <label className="block text-[10px] font-medium text-slate-400 mb-1">
                End date (defaults to start)
              </label>
              <input
                type="date"
                value={endDate}
                min={startDate || undefined}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full bg-white/[0.04] border border-white/[0.1] text-white rounded-lg px-2 py-2 text-xs outline-none focus:border-accent"
              />
            </div>
          </div>

          {/* Time row with Full Day toggle. */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Time</label>
              <button
                type="button"
                onClick={() => setIsFullDay((v) => !v)}
                className={`px-3 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                  isFullDay ? 'bg-accent/15 text-accent' : 'bg-white/[0.04] text-slate-400'
                }`}
              >
                {isFullDay ? 'Full Day' : 'Custom Hours'}
              </button>
            </div>
            {!isFullDay && (
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="bg-white/[0.04] border border-white/[0.1] text-white rounded-lg px-2 py-2 text-xs outline-none focus:border-accent"
                />
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="bg-white/[0.04] border border-white/[0.1] text-white rounded-lg px-2 py-2 text-xs outline-none focus:border-accent"
                />
              </div>
            )}
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

          {/* Resources — grouped by type so admins see the standardized
              "Indoor Astro Turf / Natural Turf / Cement Wicket" labels
              instead of just the raw resource name. Scopes a machine
              block to a specific surface (the "Yantra at Outdoor Net"
              case from task 6). */}
          {resources.length > 0 && (
            <div className="mb-4 space-y-2">
              <label className="block text-[10px] font-medium text-slate-400 mb-0.5 uppercase tracking-wider">
                Resources (optional)
              </label>
              <p className="text-[10px] text-slate-500">
                Pin specific nets/wickets to scope this block. A machine
                block without a resource pin will apply to every pitch
                the machine could land on.
              </p>
              {Object.entries(
                resources.reduce<Record<string, CenterResource[]>>((acc, r) => {
                  const key = r.type;
                  if (!acc[key]) acc[key] = [];
                  acc[key].push(r);
                  return acc;
                }, {}),
              ).map(([type, list]) => (
                <div key={type}>
                  <p className="text-[10px] font-semibold text-slate-500 mb-1">{resourceTypeLabel(type)}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {list.map((r) => {
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
              ))}
            </div>
          )}

          {/* Partial Cricket-Net cap. Only meaningful when Cricket Nets
              category is selected without a specific resource pin —
              admin says "reserve N nets, leave the rest bookable". */}
          {pickedCategories.includes('NET') && pickedResourceIds.length === 0 && (
            <div className="mb-4">
              <label className="block text-[10px] font-medium text-slate-400 mb-1 uppercase tracking-wider">
                Number of Nets to Block (optional)
              </label>
              <input
                type="number"
                min={1}
                placeholder="Leave empty to block all nets"
                value={netCount}
                onChange={(e) => setNetCount(e.target.value)}
                className="w-full bg-white/[0.04] border border-white/[0.1] text-white rounded-lg px-2 py-2 text-xs outline-none focus:border-accent placeholder:text-slate-600"
              />
              <p className="text-[10px] text-slate-500 mt-1">
                Empty = block every indoor net (legacy behaviour). Setting
                a number reserves that many nets and leaves the rest
                available for booking. Full Indoor Court is auto-unavailable
                whenever any nets are blocked.
              </p>
            </div>
          )}

          {/* Reason + audience */}
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

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={resetForm}
              className="px-4 py-2.5 bg-white/[0.04] text-slate-400 rounded-lg text-xs font-medium hover:bg-white/[0.08] transition-colors cursor-pointer"
            >
              Reset
            </button>
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
      )}

      {/* ═══ Active Blocks tab ═══ */}
      {activeTab === 'active' && (
        <div className="bg-white/[0.03] border border-white/[0.07] rounded-xl p-4">
          {blocks.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-14 h-14 rounded-full bg-white/[0.04] flex items-center justify-center mx-auto mb-3">
                <Ban className="w-6 h-6 text-slate-600" />
              </div>
              <p className="text-sm text-slate-400 mb-1">No active blocks</p>
              <p className="text-xs text-slate-600">All slots are currently available for booking.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {blocks.map((b) => {
                const dateStr =
                  b.startDate.slice(0, 10) === b.endDate.slice(0, 10)
                    ? format(new Date(b.startDate), 'EEE, dd MMM yyyy')
                    : `${format(new Date(b.startDate), 'dd MMM')} → ${format(new Date(b.endDate), 'dd MMM yyyy')}`;
                const timeStr =
                  b.startTime && b.endTime
                    ? `${isoTimeToIstHHMM(b.startTime)}–${isoTimeToIstHHMM(b.endTime)}`
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
                    className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-3.5 flex items-start gap-3"
                  >
                    {/* Left color bar */}
                    <div className="w-1 self-stretch rounded-full bg-red-500/40 flex-shrink-0" />

                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1.5">
                        <span className="text-sm font-semibold text-white flex items-center gap-1.5">
                          <Calendar className="w-3 h-3 text-accent" /> {dateStr}
                        </span>
                        {b.startTime && b.endTime ? (
                          <span className="text-[10px] font-medium text-slate-400 bg-white/[0.04] px-2 py-0.5 rounded-md">
                            {timeStr}
                          </span>
                        ) : (
                          <span className="text-[10px] font-semibold text-red-400 bg-red-500/10 px-2 py-0.5 rounded-md">
                            Full Day
                          </span>
                        )}
                        {b.recurringDays.length > 0 && (
                          <span className="text-accent/80 text-[10px] px-1.5 py-0.5 rounded-md bg-accent/10">
                            Every {[...b.recurringDays].sort((a, b) => a - b).map((d) => DAY_LABELS[d]).join(', ')}
                          </span>
                        )}
                        <span
                          className={`text-[10px] font-medium px-2 py-0.5 rounded-md ${
                            b.appliesTo === 'SPECIAL'
                              ? 'bg-purple-500/10 text-purple-400'
                              : b.appliesTo === 'NON_SPECIAL'
                              ? 'bg-orange-500/10 text-orange-400'
                              : 'bg-slate-500/10 text-slate-400'
                          }`}
                        >
                          {b.appliesTo === 'SPECIAL'
                            ? 'Special Users Only'
                            : b.appliesTo === 'NON_SPECIAL'
                            ? 'Non-Special Users Only'
                            : 'All Users'}
                        </span>
                      </div>

                      {(b.categories.length > 0 || machineNames.length > 0 || resourceNames.length > 0 || b.netCount != null) && (
                        <div className="flex flex-wrap items-center gap-1.5 mt-1">
                          {b.categories.map((c) => (
                            <span
                              key={c}
                              className="text-[10px] text-purple-300/80 px-2 py-0.5 rounded-md bg-purple-500/10"
                            >
                              {CATEGORY_LABELS[c] ?? c}
                            </span>
                          ))}
                          {/* Partial-cap badge — appears next to the
                              Cricket Nets category chip when admin set
                              a sub-pool count. Reads as "Cricket Nets
                              × 2 nets" so the partial cap is obvious. */}
                          {b.netCount != null && b.categories.includes('NET') && (
                            <span className="text-[10px] text-yellow-300/90 px-2 py-0.5 rounded-md bg-yellow-500/10">
                              {b.netCount} {b.netCount === 1 ? 'net' : 'nets'}
                            </span>
                          )}
                          {machineNames.map((n) => (
                            <span
                              key={`m-${n}`}
                              className="text-[10px] text-cyan-300/80 px-2 py-0.5 rounded-md bg-cyan-500/10"
                            >
                              {n}
                            </span>
                          ))}
                          {resourceNames.map((n) => (
                            <span
                              key={`r-${n}`}
                              className="text-[10px] text-emerald-300/80 px-2 py-0.5 rounded-md bg-emerald-500/10"
                            >
                              {n}
                            </span>
                          ))}
                        </div>
                      )}

                      {b.reason && (
                        <p className="text-[11px] text-slate-400 italic mt-1.5">{b.reason}</p>
                      )}
                      {(b.machineId || b.machineIds.length > 0 || b.machineType || b.pitchType) && (
                        <p className="text-[10px] text-slate-600 mt-1 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          Includes legacy ABCA targeting (machineId / pitchType) — edit here re-saves with
                          resource-based axes only.
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => startEditBlock(b)}
                        className="p-2 text-slate-500 hover:text-accent hover:bg-accent/10 rounded-lg transition-colors cursor-pointer"
                        title="Edit block"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(b.id)}
                        className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer"
                        title="Remove block"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══ Edit modal ═══ */}
      {editingBlock && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setEditingBlock(null)} />
          <div className="relative bg-[#0f1729] border border-white/[0.08] rounded-2xl p-5 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-white">Edit Block</h3>
              <button
                onClick={() => setEditingBlock(null)}
                className="p-1.5 hover:bg-white/[0.06] rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>

            <div className="space-y-3">
              {/* Date range */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-medium text-slate-500 mb-1 uppercase tracking-wider">
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={editForm.startDate}
                    onChange={(e) => setEditForm((f) => ({ ...f, startDate: e.target.value }))}
                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent/50"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-slate-500 mb-1 uppercase tracking-wider">
                    End Date
                  </label>
                  <input
                    type="date"
                    value={editForm.endDate}
                    min={editForm.startDate || undefined}
                    onChange={(e) => setEditForm((f) => ({ ...f, endDate: e.target.value }))}
                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent/50"
                  />
                </div>
              </div>

              {/* Time */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Time</label>
                  <button
                    type="button"
                    onClick={() => setEditForm((f) => ({ ...f, isFullDay: !f.isFullDay }))}
                    className={`px-3 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                      editForm.isFullDay ? 'bg-accent/15 text-accent' : 'bg-white/[0.04] text-slate-400'
                    }`}
                  >
                    {editForm.isFullDay ? 'Full Day' : 'Custom Hours'}
                  </button>
                </div>
                {!editForm.isFullDay && (
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="time"
                      value={editForm.startTime}
                      onChange={(e) => setEditForm((f) => ({ ...f, startTime: e.target.value }))}
                      className="bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent/50"
                    />
                    <input
                      type="time"
                      value={editForm.endTime}
                      onChange={(e) => setEditForm((f) => ({ ...f, endTime: e.target.value }))}
                      className="bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent/50"
                    />
                  </div>
                )}
              </div>

              {/* Recurring days */}
              <div>
                <label className="block text-[10px] font-medium text-slate-500 mb-1.5 uppercase tracking-wider">
                  Repeat On (optional)
                </label>
                <div className="grid grid-cols-7 gap-1.5">
                  {DAY_NUMBERS.map((day) => {
                    const selected = editForm.recurringDays.includes(day);
                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() =>
                          setEditForm((f) => ({
                            ...f,
                            recurringDays: toggleInArray(f.recurringDays, day),
                          }))
                        }
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
              </div>

              {/* Categories */}
              <div>
                <label className="block text-[10px] font-medium text-slate-500 mb-1.5 uppercase tracking-wider">
                  Categories (optional)
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {ALL_CATEGORIES.map((c) => {
                    const selected = editForm.pickedCategories.includes(c);
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() =>
                          setEditForm((f) => ({
                            ...f,
                            pickedCategories: toggleInArray(f.pickedCategories, c),
                          }))
                        }
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
                <div>
                  <label className="block text-[10px] font-medium text-slate-500 mb-1.5 uppercase tracking-wider">
                    Machines (optional)
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {machines.filter((m) => m.isActive).map((m) => {
                      const selected = editForm.pickedMachineIds.includes(m.id);
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() =>
                            setEditForm((f) => ({
                              ...f,
                              pickedMachineIds: toggleInArray(f.pickedMachineIds, m.id),
                            }))
                          }
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

              {/* Resources — grouped by type, same shape as the create
                  form so admins see consistent surface labels. */}
              {resources.length > 0 && (
                <div className="space-y-2">
                  <label className="block text-[10px] font-medium text-slate-500 mb-0.5 uppercase tracking-wider">
                    Resources (optional)
                  </label>
                  {Object.entries(
                    resources.reduce<Record<string, CenterResource[]>>((acc, r) => {
                      const key = r.type;
                      if (!acc[key]) acc[key] = [];
                      acc[key].push(r);
                      return acc;
                    }, {}),
                  ).map(([type, list]) => (
                    <div key={type}>
                      <p className="text-[10px] font-semibold text-slate-500 mb-1">{resourceTypeLabel(type)}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {list.map((r) => {
                          const selected = editForm.pickedResourceIds.includes(r.id);
                          return (
                            <button
                              key={r.id}
                              type="button"
                              onClick={() =>
                                setEditForm((f) => ({
                                  ...f,
                                  pickedResourceIds: toggleInArray(f.pickedResourceIds, r.id),
                                }))
                              }
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
                  ))}
                </div>
              )}

              {/* Partial Cricket-Net cap in the edit dialog. */}
              {editForm.pickedCategories.includes('NET') && editForm.pickedResourceIds.length === 0 && (
                <div>
                  <label className="block text-[10px] font-medium text-slate-500 mb-1 uppercase tracking-wider">
                    Number of Nets to Block (optional)
                  </label>
                  <input
                    type="number"
                    min={1}
                    placeholder="Leave empty to block all nets"
                    value={editForm.netCount}
                    onChange={(e) => setEditForm((f) => ({ ...f, netCount: e.target.value }))}
                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent/50 placeholder:text-slate-600"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">
                    Empty = block all nets. Otherwise N nets stay reserved
                    and the rest remain bookable.
                  </p>
                </div>
              )}

              {/* Reason */}
              <div>
                <label className="block text-[10px] font-medium text-slate-500 mb-1 uppercase tracking-wider">
                  Reason
                </label>
                <input
                  type="text"
                  value={editForm.reason}
                  onChange={(e) => setEditForm((f) => ({ ...f, reason: e.target.value }))}
                  placeholder="e.g. Pitch maintenance..."
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent/50 placeholder:text-slate-600"
                />
              </div>

              {/* Apply Block To */}
              <div>
                <label className="block text-[10px] font-medium text-slate-500 mb-2 uppercase tracking-wider">
                  Apply Block To
                </label>
                <div className="flex gap-2 flex-wrap">
                  {(
                    [
                      { value: 'ALL', label: 'All Users' },
                      { value: 'NON_SPECIAL', label: 'Non-Special Only' },
                      { value: 'SPECIAL', label: 'Special Only' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setEditForm((f) => ({ ...f, appliesTo: opt.value }))}
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
              <button
                onClick={handleEditSave}
                disabled={editLoading}
                className="flex-1 inline-flex items-center justify-center gap-2 bg-accent/15 hover:bg-accent/25 text-accent border border-accent/25 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all cursor-pointer disabled:opacity-40"
              >
                {editLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {editLoading ? 'Saving...' : 'Save Changes'}
              </button>
              <button
                onClick={() => setEditingBlock(null)}
                className="px-4 py-2.5 bg-white/[0.04] text-slate-400 rounded-xl text-sm font-medium hover:bg-white/[0.08] transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

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
