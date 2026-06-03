'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { Users, Loader2, Save, ChevronUp, ChevronDown, Check, Calendar, ListOrdered, Wrench, CalendarClock, Trash2, Plus, Pencil } from 'lucide-react';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { useCenter } from '@/lib/center-context';
import { getISTDateString } from '@/lib/time';

// ─── Types ───────────────────────────────────────────────
// An assignment row from the API. ABCA-style centers populate
// `machineId` (legacy enum); resource-based centers (Toplay) populate
// `machineRowId` (FK to Machine table). Exactly one is non-null.
interface OperatorAssignment {
  id: string;
  machineId: string | null;
  machineRowId: string | null;
  days: number[];
  createdAt: string;
  machineRow?: {
    id: string;
    name: string;
    shortName: string | null;
    isActive: boolean;
    machineType: { code: string; name: string };
  } | null;
}

interface DayPriority {
  morning: number;
  evening: number;
}

interface Operator {
  id: string;
  name: string | null;
  email: string | null;
  mobileNumber: string | null;
  operatorPriority: number;
  operatorMorningPriority: number;
  operatorEveningPriority: number;
  operatorDayPriorities: Record<string, DayPriority> | null;
  operatorAssignments: OperatorAssignment[];
}

// ─── Constants ───────────────────────────────────────────
// Legacy enum machines for MACHINE_PITCH centers (ABCA).
// RESOURCE_BASED centers (Toplay) build their assignables list from
// the center's `Machine` rows at runtime.
const LEGACY_MACHINE_IDS = ['GRAVITY', 'YANTRA', 'LEVERAGE_INDOOR', 'LEVERAGE_OUTDOOR'];
const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_NUMBERS = [0, 1, 2, 3, 4, 5, 6];

const LEGACY_MACHINE_LABELS: Record<string, { name: string; short: string }> = {
  GRAVITY: { name: 'Gravity', short: 'Gravity' },
  YANTRA: { name: 'Yantra', short: 'Yantra' },
  LEVERAGE_INDOOR: { name: 'iWinner', short: 'Tennis In' },
  LEVERAGE_OUTDOOR: { name: 'iWinner', short: 'Tennis Out' },
};

/**
 * A booking-model-agnostic "assignable unit" — what an operator can be
 * assigned to. For ABCA this is the legacy MachineId enum value; for
 * Toplay, a specific Machine row.
 *
 * `refKey` is the local React key (stable across renders).
 * `payload` is exactly the API body shape — pass it straight to POST/
 * DELETE on /api/admin/operators.
 */
interface MachineAssignable {
  refKey: string;
  name: string;
  short: string;
  payload: { machineId?: string; machineRowId?: string };
}

/** Center machine list (matches /api/centers/[id]/machines). */
interface CenterMachine {
  id: string;
  name: string;
  shortName?: string | null;
  isActive: boolean;
  machineType: { code: string; name: string };
}

type TabKey = 'schedule' | 'priority' | 'dateOverrides';

const TABS: { key: TabKey; label: string; icon: typeof Calendar }[] = [
  { key: 'schedule', label: 'Schedule', icon: Calendar },
  { key: 'priority', label: 'Priority', icon: ListOrdered },
  { key: 'dateOverrides', label: 'Date Overrides', icon: CalendarClock },
];

// ─── OperatorNumberField (numeric input with focus handling) ─
function OperatorNumberField({ label, value, onChange, placeholder, labelColor, minValue = 0, className: extraClass }: {
  label?: string;
  value: number;
  onChange: (v: number) => void;
  placeholder?: string;
  labelColor?: string;
  minValue?: number;
  className?: string;
}) {
  const emptyValue = minValue > 0 ? minValue : 0;
  const [localValue, setLocalValue] = useState<string>(value <= emptyValue ? '' : String(value));
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      setLocalValue(value <= emptyValue ? '' : String(value));
    }
  }, [value, isFocused, emptyValue]);

  return (
    <div>
      {label && <label className={`block text-[9px] font-medium mb-0.5 ${labelColor || 'text-slate-400'}`}>{label}</label>}
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={localValue}
        onFocus={() => setIsFocused(true)}
        onChange={e => {
          const raw = e.target.value;
          if (raw !== '' && !/^\d+$/.test(raw)) return;
          setLocalValue(raw);
          if (raw !== '') {
            onChange(Math.max(minValue, Number(raw)));
          }
        }}
        onBlur={() => {
          setIsFocused(false);
          if (localValue === '' || isNaN(Number(localValue))) {
            setLocalValue('');
            onChange(emptyValue);
          } else {
            const num = Math.max(minValue, Number(localValue));
            setLocalValue(num <= emptyValue ? '' : String(num));
            onChange(num);
          }
        }}
        placeholder={placeholder || String(emptyValue)}
        className={extraClass || "w-full bg-white/[0.04] border border-white/[0.1] text-white rounded-lg px-2 py-1.5 text-[11px] outline-none focus:border-accent placeholder:text-slate-600"}
      />
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────
// Center-aware operator management. The backbone (priority order,
// schedule, date overrides) is the same for both booking models; the
// only piece that varies is the "Machine Assignments" grid — its
// columns come from the legacy enum for MACHINE_PITCH centers and
// from the center's Machine[] rows for RESOURCE_BASED centers.
export default function AdminOperators() {
  useSession();
  const toast = useToast();
  const { currentCenter } = useCenter();

  // ─── Shared state ──────────────────
  const [operators, setOperators] = useState<Operator[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>('schedule');

  // ─── Schedule tab state ────────────
  const [operatorSchedule, setOperatorSchedule] = useState<Record<string, number>>({});
  const [operatorScheduleDefault, setOperatorScheduleDefault] = useState(1);
  const [savingSchedule, setSavingSchedule] = useState(false);

  // ─── Priority tab state ────────────
  const [selectedDay, setSelectedDay] = useState(1); // 1=Monday
  const [selectedSlab, setSelectedSlab] = useState<'morning' | 'evening'>('morning');
  // Per day+slab ordered operator IDs: key = "day-slab", value = ordered operator IDs
  const [priorityOrders, setPriorityOrders] = useState<Record<string, string[]>>({});
  const [savingPriorities, setSavingPriorities] = useState(false);
  const [togglingAssignment, setTogglingAssignment] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<'schedule' | 'priority' | null>(null);

  // ─── Center machines (RESOURCE_BASED only) ──────
  // For Toplay-style centers, this is the live list of Machine rows
  // we surface as assignment columns in the Priority tab. ABCA centers
  // ignore this and use the legacy 4-enum list.
  const [centerMachines, setCenterMachines] = useState<CenterMachine[]>([]);
  const [bookingModel, setBookingModel] = useState<'MACHINE_PITCH' | 'RESOURCE_BASED'>('MACHINE_PITCH');

  // ─── Date Overrides tab state ──────
  // A range is either slab-based (morning/evening counts) or a time window
  // (startTime/endTime + a single count applied to slots in that window).
  interface OverrideRange { from: string; to: string; morning?: number; evening?: number; recurringDays?: number[]; startTime?: string; endTime?: string; count?: number }
  const [dateOverrides, setDateOverrides] = useState<OverrideRange[]>([]);
  const [newOverrideMode, setNewOverrideMode] = useState<'slab' | 'time'>('slab');
  const [newOverrideFromDate, setNewOverrideFromDate] = useState('');
  const [newOverrideToDate, setNewOverrideToDate] = useState('');
  const [newOverrideMorning, setNewOverrideMorning] = useState(1);
  const [newOverrideEvening, setNewOverrideEvening] = useState(1);
  const [newOverrideStartTime, setNewOverrideStartTime] = useState('');
  const [newOverrideEndTime, setNewOverrideEndTime] = useState('');
  const [newOverrideCount, setNewOverrideCount] = useState(1);
  const [newOverrideRecurringDays, setNewOverrideRecurringDays] = useState<number[]>([]);
  const [savingOverrides, setSavingOverrides] = useState(false);
  const [pendingOverrides, setPendingOverrides] = useState<OverrideRange[] | null>(null);
  const [editingOverrideIndex, setEditingOverrideIndex] = useState<number | null>(null);


  // ═══════════════════════════════════════════════════════
  // DATA FETCHING
  // ═══════════════════════════════════════════════════════

  useEffect(() => {
    fetchOperators();
    fetchOperatorSchedule();
    fetchDateOverrides();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refetch machines whenever the active center changes — operator
  // assignments are scoped to the center, and the column list of
  // assignables is the center's Machine rows. ABCA gets an empty
  // response from the public machines endpoint (its 4 are seeded with
  // legacyMachineId set), so the legacy fallback kicks in.
  useEffect(() => {
    if (!currentCenter) return;
    let cancelled = false;
    fetch(`/api/centers/${currentCenter.id}/machines`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: CenterMachine[]) => {
        if (cancelled) return;
        setCenterMachines(Array.isArray(rows) ? rows : []);
      })
      .catch(() => setCenterMachines([]));
    return () => {
      cancelled = true;
    };
  }, [currentCenter]);

  const fetchOperators = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/operators');
      if (res.ok) {
        const data = await res.json();
        setOperators(data.operators || []);
        if (data.bookingModel === 'RESOURCE_BASED' || data.bookingModel === 'MACHINE_PITCH') {
          setBookingModel(data.bookingModel);
        }
      } else {
        toast.error('Failed to fetch operators');
      }
    } catch (err) {
      console.error('Fetch error:', err);
      toast.error('Failed to fetch operators');
    } finally {
      setLoading(false);
    }
  };

  const fetchOperatorSchedule = async () => {
    try {
      const res = await fetch('/api/admin/policies');
      if (res.ok) {
        const data = await res.json();
        const policyArray: { key: string; value: string }[] = Array.isArray(data) ? data : (data.policies || []);
        const configPolicy = policyArray.find(p => p.key === 'OPERATOR_SCHEDULE_CONFIG');
        if (configPolicy) {
          const parsed = JSON.parse(configPolicy.value);
          setOperatorScheduleDefault(parsed.default || 1);
          const scheduleMap: Record<string, number> = {};
          for (const entry of (parsed.schedule || [])) {
            for (const day of entry.days) {
              scheduleMap[`${day}-${entry.slab}`] = entry.count;
            }
          }
          setOperatorSchedule(scheduleMap);
        }
      }
    } catch (error) {
      console.error('Failed to fetch operator schedule:', error);
    }
  };

  const fetchDateOverrides = async () => {
    try {
      const res = await fetch('/api/admin/policies');
      if (res.ok) {
        const data = await res.json();
        const policyArray: { key: string; value: string }[] = Array.isArray(data) ? data : (data.policies || []);
        const overridePolicy = policyArray.find(p => p.key === 'OPERATOR_DATE_OVERRIDES');
        if (overridePolicy) {
          const parsed = JSON.parse(overridePolicy.value);
          // Support legacy format (object with date keys) by converting to range array
          if (Array.isArray(parsed)) {
            setDateOverrides(parsed);
          } else {
            // Migrate: group consecutive dates with same values into ranges
            const entries = Object.entries(parsed as Record<string, { morning: number; evening: number }>)
              .sort(([a], [b]) => a.localeCompare(b));
            const ranges: OverrideRange[] = [];
            for (const [date, counts] of entries) {
              const last = ranges[ranges.length - 1];
              // Check if this date extends the previous range (consecutive + same values)
              if (last && last.morning === counts.morning && last.evening === counts.evening) {
                const nextDay = new Date(last.to + 'T12:00:00');
                nextDay.setDate(nextDay.getDate() + 1);
                const nextStr = `${nextDay.getFullYear()}-${String(nextDay.getMonth() + 1).padStart(2, '0')}-${String(nextDay.getDate()).padStart(2, '0')}`;
                if (nextStr === date) {
                  last.to = date;
                  continue;
                }
              }
              ranges.push({ from: date, to: date, morning: counts.morning, evening: counts.evening });
            }
            setDateOverrides(ranges);
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch date overrides:', error);
    }
  };

  const saveDateOverrides = async (overrides: OverrideRange[]) => {
    setSavingOverrides(true);
    try {
      const res = await fetch('/api/admin/policies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'OPERATOR_DATE_OVERRIDES', value: JSON.stringify(overrides) }),
      });
      if (res.ok) {
        setDateOverrides(overrides);
        toast.success('Date overrides saved');

        // Auto-cancel bookings for zero-operator slots
        const hasZeroSlots = overrides.some(r => r.morning === 0 || r.evening === 0 || r.count === 0);
        if (hasZeroSlots) {
          try {
            const cancelRes = await fetch('/api/admin/override-cancellations', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ overrides }),
            });
            if (cancelRes.ok) {
              const result = await cancelRes.json();
              if (result.cancelled > 0) {
                toast.success(`${result.cancelled} booking(s) cancelled & refunded to wallets`);
              }
            }
          } catch (err) {
            console.error('Override cancellation failed:', err);
          }
        }
      } else {
        toast.error('Failed to save date overrides');
      }
    } catch {
      toast.error('Failed to save date overrides');
    } finally {
      setSavingOverrides(false);
    }
  };

  const confirmAndSaveOverrides = (updated: OverrideRange[]) => {
    const hasZeroSlots = updated.some(r => r.morning === 0 || r.evening === 0 || r.count === 0);
    if (hasZeroSlots) {
      setPendingOverrides(updated);
    } else {
      saveDateOverrides(updated);
    }
  };

  const resetOverrideForm = () => {
    setNewOverrideMode('slab');
    setNewOverrideFromDate('');
    setNewOverrideToDate('');
    setNewOverrideMorning(1);
    setNewOverrideEvening(1);
    setNewOverrideStartTime('');
    setNewOverrideEndTime('');
    setNewOverrideCount(1);
    setNewOverrideRecurringDays([]);
    setEditingOverrideIndex(null);
  };

  const startEditOverride = (index: number) => {
    const r = dateOverrides[index];
    if (!r) return;
    const isTimeWindow = !!r.startTime && !!r.endTime;
    setNewOverrideMode(isTimeWindow ? 'time' : 'slab');
    setNewOverrideFromDate(r.from);
    setNewOverrideToDate(r.to);
    setNewOverrideMorning(r.morning ?? 1);
    setNewOverrideEvening(r.evening ?? 1);
    setNewOverrideStartTime(r.startTime ?? '');
    setNewOverrideEndTime(r.endTime ?? '');
    setNewOverrideCount(r.count ?? 1);
    setNewOverrideRecurringDays(r.recurringDays ? [...r.recurringDays] : []);
    setEditingOverrideIndex(index);
  };

  const addDateOverride = () => {
    if (!newOverrideFromDate) {
      toast.error('Please select a from date');
      return;
    }
    const todayISO = getISTDateString();
    if (newOverrideFromDate < todayISO) {
      toast.error('From date cannot be before today');
      return;
    }
    const toDate = newOverrideToDate || newOverrideFromDate;
    if (toDate < newOverrideFromDate) {
      toast.error('To date must be on or after from date');
      return;
    }
    if (newOverrideMode === 'time') {
      if (!newOverrideStartTime || !newOverrideEndTime) {
        toast.error('Please select start and end times');
        return;
      }
      if (newOverrideEndTime <= newOverrideStartTime) {
        toast.error('End time must be after start time');
        return;
      }
    }
    const recurring = newOverrideRecurringDays.length > 0
      ? { recurringDays: [...newOverrideRecurringDays].sort((a, b) => a - b) }
      : {};
    const newRange: OverrideRange = newOverrideMode === 'time'
      ? {
          from: newOverrideFromDate,
          to: toDate,
          startTime: newOverrideStartTime,
          endTime: newOverrideEndTime,
          count: newOverrideCount,
          ...recurring,
        }
      : {
          from: newOverrideFromDate,
          to: toDate,
          morning: newOverrideMorning,
          evening: newOverrideEvening,
          ...recurring,
        };
    const base = editingOverrideIndex !== null
      ? dateOverrides.filter((_, i) => i !== editingOverrideIndex)
      : dateOverrides;
    const updated = [...base, newRange].sort((a, b) => a.from.localeCompare(b.from));
    confirmAndSaveOverrides(updated);
    resetOverrideForm();
  };

  const removeDateOverride = (index: number) => {
    if (editingOverrideIndex === index) resetOverrideForm();
    const updated = dateOverrides.filter((_, i) => i !== index);
    saveDateOverrides(updated);
  };

  // ═══════════════════════════════════════════════════════
  // SCHEDULE TAB HELPERS
  // ═══════════════════════════════════════════════════════

  const getScheduleCount = (day: number, slab: string) => {
    return operatorSchedule[`${day}-${slab}`] ?? operatorScheduleDefault;
  };

  const setScheduleCount = (day: number, slab: string, count: number) => {
    setOperatorSchedule(prev => ({ ...prev, [`${day}-${slab}`]: Math.max(0, count) }));
  };

  const saveSchedule = async () => {
    setSavingSchedule(true);
    try {
      const morningDays: Record<number, number[]> = {};
      const eveningDays: Record<number, number[]> = {};
      for (const day of DAY_NUMBERS) {
        const mc = getScheduleCount(day, 'morning');
        const ec = getScheduleCount(day, 'evening');
        if (!morningDays[mc]) morningDays[mc] = [];
        morningDays[mc].push(day);
        if (!eveningDays[ec]) eveningDays[ec] = [];
        eveningDays[ec].push(day);
      }
      const schedule: { days: number[]; slab: string; count: number }[] = [];
      for (const [count, days] of Object.entries(morningDays)) {
        if (Number(count) !== operatorScheduleDefault) {
          schedule.push({ days, slab: 'morning', count: Number(count) });
        }
      }
      for (const [count, days] of Object.entries(eveningDays)) {
        if (Number(count) !== operatorScheduleDefault) {
          schedule.push({ days, slab: 'evening', count: Number(count) });
        }
      }
      const scheduleConfig = { default: operatorScheduleDefault, schedule };
      const res = await fetch('/api/admin/policies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'OPERATOR_SCHEDULE_CONFIG', value: JSON.stringify(scheduleConfig) }),
      });
      if (res.ok) {
        toast.success('Operator schedule saved');
      } else {
        toast.error('Failed to save schedule');
      }
    } catch {
      toast.error('Failed to save schedule');
    } finally {
      setSavingSchedule(false);
    }
  };

  // ═══════════════════════════════════════════════════════
  // PRIORITY TAB HELPERS
  // ═══════════════════════════════════════════════════════

  // Initialize priority orders from operator data when operators load
  useEffect(() => {
    if (operators.length === 0) return;
    const orders: Record<string, string[]> = {};

    for (const day of DAY_NUMBERS) {
      for (const slab of ['morning', 'evening'] as const) {
        const key = `${day}-${slab}`;
        // Sort operators by their day-specific priority for this day+slab
        const sorted = [...operators].sort((a, b) => {
          const aPri = (a.operatorDayPriorities?.[String(day)] as DayPriority)?.[slab] || 0;
          const bPri = (b.operatorDayPriorities?.[String(day)] as DayPriority)?.[slab] || 0;
          // 0 = unset, push to end; otherwise lower = higher priority
          if (aPri === 0 && bPri === 0) return 0;
          if (aPri === 0) return 1;
          if (bPri === 0) return -1;
          return aPri - bPri;
        });
        orders[key] = sorted.map(op => op.id);
      }
    }
    setPriorityOrders(orders);
  }, [operators]);

  const currentPriorityKey = `${selectedDay}-${selectedSlab}`;
  const currentOrder = priorityOrders[currentPriorityKey] || operators.map(op => op.id);
  const orderedOperators = currentOrder
    .map(id => operators.find(op => op.id === id))
    .filter((op): op is Operator => op !== undefined);

  const moveOperatorInSlot = (index: number, direction: 'up' | 'down') => {
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= currentOrder.length) return;
    setPriorityOrders(prev => {
      const arr = [...(prev[currentPriorityKey] || currentOrder)];
      [arr[index], arr[swapIndex]] = [arr[swapIndex], arr[index]];
      return { ...prev, [currentPriorityKey]: arr };
    });
  };

  const savePriorities = async () => {
    setSavingPriorities(true);
    try {
      // Build dayPriorities per operator from all day+slab orderings
      const operatorDayPriMap: Record<string, Record<string, DayPriority>> = {};
      for (const op of operators) {
        operatorDayPriMap[op.id] = {};
        for (const day of DAY_NUMBERS) {
          operatorDayPriMap[op.id][String(day)] = { morning: 0, evening: 0 };
        }
      }

      for (const day of DAY_NUMBERS) {
        for (const slab of ['morning', 'evening'] as const) {
          const key = `${day}-${slab}`;
          const order = priorityOrders[key] || operators.map(op => op.id);
          order.forEach((opId, idx) => {
            if (operatorDayPriMap[opId]) {
              operatorDayPriMap[opId][String(day)][slab] = idx + 1;
            }
          });
        }
      }

      const payload = operators.map(op => ({
        userId: op.id,
        priority: op.operatorPriority,
        dayPriorities: operatorDayPriMap[op.id],
      }));

      const res = await fetch('/api/admin/operators', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operators: payload }),
      });
      if (res.ok) {
        const data = await res.json();
        setOperators(data.operators || []);
        toast.success('Priority order saved');
      } else {
        toast.error('Failed to save priorities');
      }
    } catch {
      toast.error('Failed to save priorities');
    } finally {
      setSavingPriorities(false);
    }
  };

  // The list of assignable units shown as columns in the priority
  // tab's machine grid. ABCA → 4 hardcoded enum values. Toplay → the
  // center's active Machine rows. The `payload` field is exactly what
  // we send to the operators API, so the grid stays model-agnostic.
  const assignables: MachineAssignable[] =
    bookingModel === 'RESOURCE_BASED'
      ? centerMachines
          .filter((m) => m.isActive)
          .map((m) => ({
            refKey: m.id,
            name: m.name,
            short: m.shortName ?? m.name,
            payload: { machineRowId: m.id },
          }))
      : LEGACY_MACHINE_IDS.map((mid) => ({
          refKey: mid,
          name: LEGACY_MACHINE_LABELS[mid]?.name ?? mid,
          short: LEGACY_MACHINE_LABELS[mid]?.short ?? mid,
          payload: { machineId: mid },
        }));

  // Match an OperatorAssignment row to one of our `assignables`. Since
  // exactly one of (machineId, machineRowId) is set per row, the test
  // is straightforward.
  const matchesAssignment = (a: OperatorAssignment, unit: MachineAssignable): boolean => {
    if (unit.payload.machineId) return a.machineId === unit.payload.machineId;
    if (unit.payload.machineRowId) return a.machineRowId === unit.payload.machineRowId;
    return false;
  };

  const toggleMachineAssignment = async (
    operatorId: string,
    unit: MachineAssignable,
    isCurrentlyAssigned: boolean,
  ) => {
    const key = `${operatorId}-${unit.refKey}`;
    setTogglingAssignment(key);
    try {
      const body = { userId: operatorId, ...unit.payload };
      const method = isCurrentlyAssigned ? 'DELETE' : 'POST';
      const res = await fetch('/api/admin/operators', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(
          data.error || (isCurrentlyAssigned ? 'Failed to remove assignment' : 'Failed to assign machine'),
        );
      }
      const refreshRes = await fetch('/api/admin/operators');
      if (refreshRes.ok) {
        const data = await refreshRes.json();
        setOperators(data.operators || []);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Assignment failed');
    } finally {
      setTogglingAssignment(null);
    }
  };

  // ═══════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <AdminPageHeader
        icon={Users}
        title="Operator Management"
        description="Schedule, priorities & machine assignments"
        iconColor="text-purple-400"
        iconBg="bg-purple-500/10"
      />

      {/* ─── Tab Bar ──────────────────────────────── */}
      <div className="flex gap-1 bg-white/[0.03] p-1 rounded-lg">
        {TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-md text-xs font-medium transition-all cursor-pointer ${
                activeTab === tab.key
                  ? 'bg-accent/15 text-accent'
                  : 'text-slate-400 hover:text-slate-300 hover:bg-white/[0.03]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* ═════════════════════════════════════════════ */}
      {/* TAB 1: SCHEDULE                              */}
      {/* ═════════════════════════════════════════════ */}
      {activeTab === 'schedule' && (
        <div className="space-y-4">
          <div className="bg-white/[0.03] border border-white/[0.07] rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <Calendar className="w-4 h-4 text-accent" />
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">Operator Count per Day &amp; Slot</h3>
            </div>
            <p className="text-[10px] text-slate-500 mb-4">Define how many operators are needed for each day and time slab. Bookings auto-assign based on these counts.</p>

            {/* Default Count */}
            <div className="mb-4">
              <label className="block text-[10px] font-medium text-slate-400 mb-1">Default Count (for unlisted days)</label>
              <OperatorNumberField
                value={operatorScheduleDefault}
                onChange={val => setOperatorScheduleDefault(val)}
                placeholder="1"
                minValue={1}
                className="w-24 bg-white/[0.04] border border-white/[0.1] text-white rounded-lg px-3 py-2 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition-colors placeholder:text-slate-600"
              />
            </div>

            {/* Schedule Grid */}
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr>
                    <th className="text-left text-slate-500 font-medium pb-2 pr-2">Day</th>
                    <th className="text-center text-amber-400 font-medium pb-2 px-2">☀ Morning</th>
                    <th className="text-center text-indigo-400 font-medium pb-2 px-2">🌙 Evening</th>
                  </tr>
                </thead>
                <tbody>
                  {DAY_NUMBERS.map(day => (
                    <tr key={day} className="border-t border-white/[0.04]">
                      <td className="text-slate-300 font-medium py-1.5 pr-2">{DAY_LABELS[day]}</td>
                      <td className="text-center py-1.5 px-2">
                        <OperatorNumberField
                          value={getScheduleCount(day, 'morning')}
                          onChange={val => setScheduleCount(day, 'morning', val)}
                          placeholder="0"
                          className="w-14 bg-white/[0.04] border border-white/[0.1] text-white text-center rounded-lg px-1 py-1 text-[11px] outline-none focus:border-accent placeholder:text-slate-600"
                        />
                      </td>
                      <td className="text-center py-1.5 px-2">
                        <OperatorNumberField
                          value={getScheduleCount(day, 'evening')}
                          onChange={val => setScheduleCount(day, 'evening', val)}
                          placeholder="0"
                          className="w-14 bg-white/[0.04] border border-white/[0.1] text-white text-center rounded-lg px-1 py-1 text-[11px] outline-none focus:border-accent placeholder:text-slate-600"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Save button */}
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setConfirmAction('schedule')}
                disabled={savingSchedule}
                className="flex items-center gap-2 px-4 py-2.5 bg-accent hover:bg-accent-light text-primary text-xs font-semibold rounded-lg transition-colors cursor-pointer disabled:opacity-50"
              >
                {savingSchedule ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Save Schedule
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═════════════════════════════════════════════ */}
      {/* TAB 2: PRIORITY                              */}
      {/* ═════════════════════════════════════════════ */}
      {activeTab === 'priority' && (
        <div className="space-y-4">
          {/* Day + Slot Selector */}
          <div className="bg-white/[0.03] border border-white/[0.07] rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <ListOrdered className="w-4 h-4 text-accent" />
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">Booking Assignment Order</h3>
            </div>
            <p className="text-[10px] text-slate-500 mb-4">
              Select a day and slot, then arrange operators in the order they should receive bookings. First in list = first to get assigned.
            </p>

            {/* Day selector */}
            <div className="mb-3">
              <label className="block text-[10px] font-medium text-slate-400 mb-1.5 uppercase tracking-wider">Day</label>
              <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5">
                {DAY_NUMBERS.map(day => (
                  <button
                    key={day}
                    onClick={() => setSelectedDay(day)}
                    className={`px-2 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                      selectedDay === day
                        ? 'bg-accent/20 text-accent ring-1 ring-accent/30'
                        : 'bg-white/[0.04] text-slate-400 hover:bg-white/[0.06]'
                    }`}
                  >
                    {DAY_LABELS[day]}
                  </button>
                ))}
              </div>
            </div>

            {/* Slot selector */}
            <div className="mb-4">
              <label className="block text-[10px] font-medium text-slate-400 mb-1.5 uppercase tracking-wider">Slot</label>
              <div className="flex gap-1 bg-white/[0.02] p-1 rounded-lg w-fit">
                <button
                  onClick={() => setSelectedSlab('morning')}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-medium transition-all cursor-pointer ${
                    selectedSlab === 'morning'
                      ? 'bg-amber-500/15 text-amber-400'
                      : 'text-slate-400 hover:text-slate-300'
                  }`}
                >
                  ☀ Morning
                </button>
                <button
                  onClick={() => setSelectedSlab('evening')}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-medium transition-all cursor-pointer ${
                    selectedSlab === 'evening'
                      ? 'bg-indigo-500/15 text-indigo-400'
                      : 'text-slate-400 hover:text-slate-300'
                  }`}
                >
                  🌙 Evening
                </button>
              </div>
            </div>

            {/* Current selection label */}
            <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-white/[0.02] rounded-lg border border-white/[0.05]">
              <span className={`w-2 h-2 rounded-full ${selectedSlab === 'morning' ? 'bg-amber-400' : 'bg-indigo-400'}`} />
              <span className="text-xs font-medium text-slate-300">
                {DAYS_OF_WEEK[selectedDay]} {selectedSlab === 'morning' ? 'Morning' : 'Evening'} — Operator Priority Order
              </span>
            </div>

            {/* Operator reorder list */}
            {operators.length === 0 ? (
              <p className="text-xs text-slate-500 italic py-6 text-center">No operators found. Assign OPERATOR role to users first.</p>
            ) : (
              <div className="space-y-2">
                {orderedOperators.map((op, index) => {
                  // Render the assignment summary off the resolved
                  // assignables list so RESOURCE_BASED centers see
                  // their Machine row names ("Yantra 1") instead of the
                  // raw FK.
                  const assignedShorts = (op.operatorAssignments || [])
                    .map((a) => {
                      const unit = assignables.find((u) => matchesAssignment(a, u));
                      if (unit) return unit.short;
                      // Best-effort fallback (legacy enum row whose
                      // assignable list hasn't loaded yet).
                      if (a.machineRow) return a.machineRow.shortName ?? a.machineRow.name;
                      if (a.machineId) return LEGACY_MACHINE_LABELS[a.machineId]?.short ?? a.machineId;
                      return '';
                    })
                    .filter((s) => s.length > 0);

                  return (
                    <div
                      key={op.id}
                      className="flex items-center gap-2 bg-white/[0.02] border border-white/[0.06] rounded-xl px-3 py-2.5 hover:border-white/[0.12] transition-colors"
                    >
                      {/* Position badge */}
                      <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${
                        index === 0 ? 'bg-accent/20 text-accent' : 'bg-white/[0.04] text-slate-400'
                      }`}>
                        {index + 1}
                      </span>

                      {/* Operator info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white truncate">{op.name || 'Unnamed'}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <p className="text-[10px] text-slate-500 truncate">{op.email || op.mobileNumber || ''}</p>
                          {assignedShorts.length > 0 && (
                            <span className="text-[9px] text-accent/60">
                              {assignedShorts.join(', ')}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Move buttons */}
                      <div className="flex flex-col gap-0.5 flex-shrink-0">
                        <button
                          onClick={() => moveOperatorInSlot(index, 'up')}
                          disabled={index === 0}
                          className="p-1 text-slate-400 hover:text-white disabled:opacity-20 transition-colors cursor-pointer"
                        >
                          <ChevronUp className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => moveOperatorInSlot(index, 'down')}
                          disabled={index === orderedOperators.length - 1}
                          className="p-1 text-slate-400 hover:text-white disabled:opacity-20 transition-colors cursor-pointer"
                        >
                          <ChevronDown className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Save button */}
            {operators.length > 0 && (
              <div className="mt-4 flex justify-end">
                <button
                  onClick={() => setConfirmAction('priority')}
                  disabled={savingPriorities}
                  className="flex items-center gap-2 px-4 py-2.5 bg-accent hover:bg-accent-light text-primary text-xs font-semibold rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                >
                  {savingPriorities ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  Save All Priorities
                </button>
              </div>
            )}
          </div>

          {/* Machine Assignments (compact grid) — columns are the
              center's assignables: 4 hardcoded enums for ABCA, the
              center's active Machine rows for Toplay et al. */}
          <div className="bg-white/[0.03] border border-white/[0.07] rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Wrench className="w-4 h-4 text-accent" />
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">Machine Assignments</h3>
            </div>

            {assignables.length === 0 ? (
              <p className="text-xs text-slate-500 italic py-6 text-center">
                No machines configured at this center yet. Add machines on the
                <span className="text-accent"> Centers → Machines </span> tab to enable assignment.
              </p>
            ) : (
              <>
                {/* Column widths scale with the assignable count so the
                    grid doesn't overflow on a 6-machine center. */}
                {(() => {
                  const colTemplate = `minmax(80px, 1fr) repeat(${assignables.length}, 44px)`;
                  return (
                    <>
                      {/* Header row */}
                      <div className="grid items-center gap-1.5 mb-1" style={{ gridTemplateColumns: colTemplate }}>
                        <span className="text-[9px] text-slate-500 font-medium uppercase">Operator</span>
                        {assignables.map((unit) => (
                          <span
                            key={unit.refKey}
                            className="text-[8px] text-slate-500 font-medium text-center leading-tight truncate"
                            title={unit.name}
                          >
                            {unit.short}
                          </span>
                        ))}
                      </div>

                      {/* Operator rows */}
                      {operators.map((op) => (
                        <div
                          key={op.id}
                          className="grid items-center gap-1.5 py-1.5 border-t border-white/[0.04]"
                          style={{ gridTemplateColumns: colTemplate }}
                        >
                          <p className="text-[11px] text-white truncate" title={op.name || 'Unnamed'}>
                            {op.name || 'Unnamed'}
                          </p>
                          {assignables.map((unit) => {
                            const isAssigned = (op.operatorAssignments || []).some((a) =>
                              matchesAssignment(a, unit),
                            );
                            const isToggling = togglingAssignment === `${op.id}-${unit.refKey}`;
                            return (
                              <button
                                key={unit.refKey}
                                onClick={() => toggleMachineAssignment(op.id, unit, isAssigned)}
                                disabled={!!togglingAssignment}
                                className={`mx-auto flex items-center justify-center w-7 h-7 rounded-lg transition-all cursor-pointer disabled:opacity-60 ${
                                  isAssigned
                                    ? 'bg-accent/15 text-accent border border-accent/30'
                                    : 'bg-white/[0.04] text-slate-600 border border-white/[0.06] hover:bg-white/[0.08]'
                                }`}
                                title={`${isAssigned ? 'Remove' : 'Assign'} ${unit.name}`}
                              >
                                {isToggling ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : isAssigned ? (
                                  <Check className="w-3.5 h-3.5" />
                                ) : null}
                              </button>
                            );
                          })}
                        </div>
                      ))}
                    </>
                  );
                })()}
              </>
            )}
          </div>
        </div>
      )}

      {/* ═════════════════════════════════════════════ */}
      {/* TAB 3: DATE OVERRIDES                        */}
      {/* ═════════════════════════════════════════════ */}
      {activeTab === 'dateOverrides' && (
        <div className="space-y-4">
          {/* Add new override */}
          <div className="bg-white/[0.03] border border-white/[0.07] rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                {editingOverrideIndex !== null ? 'Edit Date Override' : 'Add Date Override'}
              </h3>
              {editingOverrideIndex !== null && (
                <button
                  type="button"
                  onClick={resetOverrideForm}
                  className="text-[10px] font-medium text-slate-400 hover:text-white px-2 py-1 rounded transition-colors cursor-pointer"
                >
                  Cancel edit
                </button>
              )}
            </div>
            <p className="text-[11px] text-slate-400 mb-3">
              Set operator count to <strong className="text-amber-400">0</strong> to make leather machines unavailable and tennis machines self-operate. Apply it to a whole slab (Morning / Evening) or to a specific time window. Select a date range to apply across multiple days.
            </p>
            {/* Mode toggle: whole-slab vs specific time window */}
            <div className="inline-flex items-center gap-1 p-0.5 mb-4 bg-white/[0.04] border border-white/[0.08] rounded-lg">
              {([['slab', 'Morning / Evening'], ['time', 'Time Slot']] as const).map(([mode, modeLabel]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setNewOverrideMode(mode)}
                  className={`px-3 py-1 rounded-md text-[10px] font-semibold transition-colors cursor-pointer ${newOverrideMode === mode
                      ? 'bg-accent/20 text-accent'
                      : 'text-slate-400 hover:text-slate-200'
                    }`}
                >
                  {modeLabel}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 items-end">
              <div>
                <label className="block text-[9px] font-medium text-slate-400 mb-0.5">From Date</label>
                <input
                  type="date"
                  value={newOverrideFromDate}
                  min={getISTDateString()}
                  onChange={e => setNewOverrideFromDate(e.target.value)}
                  className="w-full bg-white/[0.04] border border-white/[0.1] text-white rounded-lg px-2 py-1.5 text-[11px] outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="block text-[9px] font-medium text-slate-400 mb-0.5">To Date</label>
                <input
                  type="date"
                  value={newOverrideToDate}
                  min={newOverrideFromDate || getISTDateString()}
                  onChange={e => setNewOverrideToDate(e.target.value)}
                  className="w-full bg-white/[0.04] border border-white/[0.1] text-white rounded-lg px-2 py-1.5 text-[11px] outline-none focus:border-accent"
                />
              </div>
              {newOverrideMode === 'slab' ? (
                <>
                  <OperatorNumberField
                    label="Morning Operators"
                    value={newOverrideMorning}
                    onChange={setNewOverrideMorning}
                    placeholder="0"
                    labelColor="text-amber-400/70"
                  />
                  <OperatorNumberField
                    label="Evening Operators"
                    value={newOverrideEvening}
                    onChange={setNewOverrideEvening}
                    placeholder="0"
                    labelColor="text-blue-400/70"
                  />
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-[9px] font-medium text-slate-400 mb-0.5">Start Time</label>
                    <input
                      type="time"
                      value={newOverrideStartTime}
                      onChange={e => setNewOverrideStartTime(e.target.value)}
                      className="w-full bg-white/[0.04] border border-white/[0.1] text-white rounded-lg px-2 py-1.5 text-[11px] outline-none focus:border-accent"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-medium text-slate-400 mb-0.5">End Time</label>
                    <input
                      type="time"
                      value={newOverrideEndTime}
                      onChange={e => setNewOverrideEndTime(e.target.value)}
                      className="w-full bg-white/[0.04] border border-white/[0.1] text-white rounded-lg px-2 py-1.5 text-[11px] outline-none focus:border-accent"
                    />
                  </div>
                </>
              )}
              <button
                onClick={addDateOverride}
                disabled={savingOverrides || !newOverrideFromDate}
                className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-accent hover:bg-accent-light text-primary text-[11px] font-semibold rounded-lg transition-colors cursor-pointer disabled:opacity-50"
              >
                {savingOverrides ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                {editingOverrideIndex !== null ? 'Save' : 'Add'}
              </button>
            </div>
            {newOverrideMode === 'time' && (
              <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 items-end mt-3">
                <OperatorNumberField
                  label="Operators (in window)"
                  value={newOverrideCount}
                  onChange={setNewOverrideCount}
                  placeholder="0"
                  labelColor="text-blue-400/70"
                />
              </div>
            )}
            {/* Recurring day-of-week filter (optional) */}
            <div className="mt-4">
              <label className="block text-[9px] font-medium text-slate-400 mb-1.5 uppercase tracking-wider">
                Repeat on (optional) &mdash; leave empty to apply every day in range
              </label>
              <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5">
                {DAY_NUMBERS.map(day => {
                  const selected = newOverrideRecurringDays.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => setNewOverrideRecurringDays(prev =>
                        prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
                      )}
                      className={`py-1.5 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${selected
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
          </div>

          {/* Existing overrides */}
          <div className="bg-white/[0.03] border border-white/[0.07] rounded-xl p-4">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-3">Active Date Overrides</h3>
            {dateOverrides.length === 0 ? (
              <p className="text-[11px] text-slate-500 py-4 text-center">No date overrides configured</p>
            ) : (
              <div className="space-y-2">
                {dateOverrides.map((range, idx) => (
                    <div key={`${range.from}-${range.to}-${idx}`} className="flex items-center justify-between bg-white/[0.03] rounded-lg px-3 py-2.5 border border-white/[0.06]">
                      <div className="flex items-center gap-4 flex-wrap">
                        <span className="text-sm font-medium text-white">
                          {range.from === range.to ? range.from : `${range.from} → ${range.to}`}
                        </span>
                        <div className="flex gap-3 flex-wrap">
                          {range.startTime && range.endTime ? (
                            <span className={`text-[11px] px-2 py-0.5 rounded-md ${range.count === 0 ? 'bg-red-500/15 text-red-400' : 'bg-blue-500/10 text-blue-400'}`}>
                              {range.startTime}–{range.endTime}: {range.count} operator{range.count === 1 ? '' : 's'}
                            </span>
                          ) : (
                            <>
                              <span className={`text-[11px] px-2 py-0.5 rounded-md ${range.morning === 0 ? 'bg-red-500/15 text-red-400' : 'bg-amber-500/10 text-amber-400'}`}>
                                Morning: {range.morning}
                              </span>
                              <span className={`text-[11px] px-2 py-0.5 rounded-md ${range.evening === 0 ? 'bg-red-500/15 text-red-400' : 'bg-blue-500/10 text-blue-400'}`}>
                                Evening: {range.evening}
                              </span>
                            </>
                          )}
                          {range.recurringDays && range.recurringDays.length > 0 && (
                            <span className="text-[11px] px-2 py-0.5 rounded-md bg-accent/10 text-accent">
                              {[...range.recurringDays].sort((a, b) => a - b).map(d => DAY_LABELS[d]).join(', ')}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => startEditOverride(idx)}
                          disabled={savingOverrides}
                          className="p-1.5 text-slate-500 hover:text-accent hover:bg-accent/10 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                          title="Edit override"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => removeDateOverride(idx)}
                          disabled={savingOverrides}
                          className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                          title="Remove override"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Confirmation Dialog */}
      <ConfirmDialog
        open={confirmAction !== null}
        title={confirmAction === 'schedule' ? 'Save Operator Schedule' : 'Save Operator Priorities'}
        message={confirmAction === 'schedule'
          ? 'Are you sure you want to save the operator schedule? This will update the operator count configuration for all days.'
          : 'Are you sure you want to save the operator priorities? This will update the assignment order for operators.'}
        confirmLabel={confirmAction === 'schedule' ? 'Save Schedule' : 'Save Priorities'}
        loading={confirmAction === 'schedule' ? savingSchedule : savingPriorities}
        onConfirm={async () => {
          if (confirmAction === 'schedule') {
            await saveSchedule();
          } else {
            await savePriorities();
          }
          setConfirmAction(null);
        }}
        onCancel={() => setConfirmAction(null)}
      />

      {/* Zero-operator override warning */}
      <ConfirmDialog
        open={pendingOverrides !== null}
        title="Cancel Existing Bookings?"
        message="Setting operator count to 0 will automatically cancel all existing bookings for the affected slots. Refunds will be credited to users' wallets and they will be notified. Are you sure you want to proceed?"
        confirmLabel="Yes, Cancel Bookings & Save"
        loading={savingOverrides}
        onConfirm={async () => {
          if (pendingOverrides) {
            await saveDateOverrides(pendingOverrides);
          }
          setPendingOverrides(null);
        }}
        onCancel={() => setPendingOverrides(null)}
      />
    </div>
  );
}

