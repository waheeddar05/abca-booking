'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Settings, Clock, IndianRupee, Save, Loader2, Zap, Check, ChevronUp, ChevronDown, CreditCard, Banknote, Wallet, Plus, Trash2, Edit2, Tag, CalendarDays, Users } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { AdminCard } from '@/components/admin/AdminCard';
import { AdminToggle } from '@/components/admin/AdminToggle';

interface SlabPricing {
  single: number;
  consecutive: number;
}

interface PitchPricing {
  ASTRO: { morning: SlabPricing; evening: SlabPricing };
  CEMENT: { morning: SlabPricing; evening: SlabPricing };
  NATURAL: { morning: SlabPricing; evening: SlabPricing };
}

interface PricingConfig {
  leather: PitchPricing;
  yantra: PitchPricing;
  machine: PitchPricing;
  yantra_machine: PitchPricing;
  tennis: PitchPricing;
}

interface TimeSlabConfig {
  morning: { start: string; end: string };
  evening: { start: string; end: string };
}

type MachineId = 'GRAVITY' | 'YANTRA' | 'LEVERAGE_INDOOR' | 'LEVERAGE_OUTDOOR';
type PitchType = 'ASTRO' | 'CEMENT' | 'NATURAL';
type MachinePitchConfig = Record<MachineId, PitchType[]>;

interface MachineConfig {
  machines?: { id: MachineId; name: string; shortName: string; ballType: string; category: 'LEATHER' | 'TENNIS'; enabledPitchTypes: PitchType[]; allPitchTypes: PitchType[] }[];
  machinePitchConfig?: MachinePitchConfig;
  leatherMachine: {
    ballTypeSelectionEnabled: boolean;
    pitchTypeSelectionEnabled: boolean;
    leatherBallExtraCharge: number;
    machineBallExtraCharge: number;
  };
  tennisMachine: {
    pitchTypeSelectionEnabled: boolean;
    astroPitchPrice: number;
    turfPitchPrice: number;
  };
  numberOfOperators: number;
  pricingConfig: PricingConfig;
  timeSlabConfig: TimeSlabConfig;
}

const DEFAULT_PRICING: PricingConfig = {
  leather: {
    ASTRO: { morning: { single: 600, consecutive: 1000 }, evening: { single: 700, consecutive: 1200 } },
    CEMENT: { morning: { single: 600, consecutive: 1000 }, evening: { single: 700, consecutive: 1200 } },
    NATURAL: { morning: { single: 600, consecutive: 1000 }, evening: { single: 700, consecutive: 1200 } },
  },
  yantra: {
    ASTRO: { morning: { single: 700, consecutive: 1200 }, evening: { single: 800, consecutive: 1400 } },
    CEMENT: { morning: { single: 700, consecutive: 1200 }, evening: { single: 800, consecutive: 1400 } },
    NATURAL: { morning: { single: 700, consecutive: 1200 }, evening: { single: 800, consecutive: 1400 } },
  },
  machine: {
    ASTRO: { morning: { single: 500, consecutive: 800 }, evening: { single: 600, consecutive: 1000 } },
    CEMENT: { morning: { single: 500, consecutive: 800 }, evening: { single: 600, consecutive: 1000 } },
    NATURAL: { morning: { single: 500, consecutive: 800 }, evening: { single: 600, consecutive: 1000 } },
  },
  yantra_machine: {
    ASTRO: { morning: { single: 600, consecutive: 1000 }, evening: { single: 700, consecutive: 1200 } },
    CEMENT: { morning: { single: 600, consecutive: 1000 }, evening: { single: 700, consecutive: 1200 } },
    NATURAL: { morning: { single: 600, consecutive: 1000 }, evening: { single: 700, consecutive: 1200 } },
  },
  tennis: {
    ASTRO: { morning: { single: 500, consecutive: 800 }, evening: { single: 600, consecutive: 1000 } },
    CEMENT: { morning: { single: 550, consecutive: 900 }, evening: { single: 650, consecutive: 1100 } },
    NATURAL: { morning: { single: 550, consecutive: 900 }, evening: { single: 650, consecutive: 1100 } },
  },
};

const DEFAULT_TIME_SLABS: TimeSlabConfig = {
  morning: { start: '07:00', end: '17:00' },
  evening: { start: '19:00', end: '22:30' },
};

const DEFAULT_MACHINE_PITCH_CONFIG: MachinePitchConfig = {
  GRAVITY: ['ASTRO'],
  YANTRA: ['ASTRO'],
  LEVERAGE_INDOOR: ['ASTRO', 'CEMENT'],
  LEVERAGE_OUTDOOR: ['ASTRO', 'CEMENT'],
};

const MACHINE_LABELS: Record<MachineId, { name: string; category: string }> = {
  GRAVITY: { name: 'Gravity (Leather)', category: 'Leather' },
  YANTRA: { name: 'Yantra (Premium Leather)', category: 'Leather' },
  LEVERAGE_INDOOR: { name: 'Leverage Indoor', category: 'Tennis' },
  LEVERAGE_OUTDOOR: { name: 'Leverage Outdoor', category: 'Tennis' },
};

const PITCH_TYPE_LABELS: Record<PitchType, string> = {
  ASTRO: 'Astro Turf',
  CEMENT: 'Cement',
  NATURAL: 'Natural Turf',
};

const ALL_MACHINE_IDS: MachineId[] = ['GRAVITY', 'YANTRA', 'LEVERAGE_INDOOR', 'LEVERAGE_OUTDOOR'];
const ALL_PITCH_TYPES: PitchType[] = ['ASTRO', 'CEMENT', 'NATURAL'];

const PRICING_TABS = [
  { key: 'leather', label: 'Gravity · Leather' },
  { key: 'yantra', label: 'Yantra · Leather' },
  { key: 'machine', label: 'Gravity · Machine' },
  { key: 'yantra_machine', label: 'Yantra · Machine' },
  { key: 'tennis', label: 'Tennis' },
] as const;

const priceInputClass = "w-full bg-white/[0.04] border border-white/[0.1] text-white placeholder:text-slate-500 rounded-lg pl-7 pr-2 py-2 text-[16px] sm:text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition-colors";

function PriceField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const [localValue, setLocalValue] = useState<string>(String(value));
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      setLocalValue(String(value));
    }
  }, [value, isFocused]);

  return (
    <div className="scroll-mt-24">
      <label className="block text-[10px] font-medium text-slate-400 mb-1">{label}</label>
      <div className="relative">
        <IndianRupee className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500" />
        <input
          type="number"
          inputMode="decimal"
          value={localValue}
          onFocus={() => setIsFocused(true)}
          onChange={e => {
            setLocalValue(e.target.value);
            const num = Number(e.target.value);
            if (e.target.value !== '' && !isNaN(num)) {
              onChange(num);
            }
          }}
          onBlur={() => {
            setIsFocused(false);
            if (localValue === '' || isNaN(Number(localValue))) {
              setLocalValue('0');
              onChange(0);
            }
          }}
          min="0"
          className={priceInputClass}
        />
      </div>
    </div>
  );
}

export default function ConfigurationPage() {
  const { data: session } = useSession();

  // Machine config state
  const [machineConfig, setMachineConfig] = useState<MachineConfig>({
    leatherMachine: { ballTypeSelectionEnabled: false, pitchTypeSelectionEnabled: false, leatherBallExtraCharge: 100, machineBallExtraCharge: 0 },
    tennisMachine: { pitchTypeSelectionEnabled: false, astroPitchPrice: 600, turfPitchPrice: 700 },
    numberOfOperators: 1,
    pricingConfig: DEFAULT_PRICING,
    timeSlabConfig: DEFAULT_TIME_SLABS,
    machinePitchConfig: DEFAULT_MACHINE_PITCH_CONFIG,
  });
  const [machineLoading, setMachineLoading] = useState(true);
  const [savingMachine, setSavingMachine] = useState(false);
  const [machineMessage, setMachineMessage] = useState({ text: '', type: '' });
  const [showMachineConfigConfirm, setShowMachineConfigConfirm] = useState(false);
  const [operators, setOperators] = useState<{ id: string; name: string | null; email: string | null; mobileNumber: string | null; operatorPriority: number; operatorMorningPriority: number; operatorEveningPriority: number; operatorAssignments?: { id: string; machineId: string; createdAt: string }[] }[]>([]);
  const [savingPriority, setSavingPriority] = useState(false);
  const [togglingAssignment, setTogglingAssignment] = useState<string | null>(null);
  const [activePricingTab, setActivePricingTab] = useState<string>('leather');

  // Operator Schedule Config (Feature 3)
  const [operatorSchedule, setOperatorSchedule] = useState<Record<string, number>>({});
  const [operatorScheduleDefault, setOperatorScheduleDefault] = useState(1);
  const [savingSchedule, setSavingSchedule] = useState(false);

  // Recurring Slot Discounts (Feature 1)
  interface RecurringDiscountRule {
    id: string;
    enabled: boolean;
    days: number[];
    slotStartTime: string;
    slotEndTime: string;
    machineId: string | null;
    oneSlotDiscount: number;
    twoSlotDiscount: number;
  }
  const [recurringRules, setRecurringRules] = useState<RecurringDiscountRule[]>([]);
  const [recurringLoading, setRecurringLoading] = useState(true);
  const [showAddRule, setShowAddRule] = useState(false);
  const [editingRule, setEditingRule] = useState<RecurringDiscountRule | null>(null);
  const [ruleForm, setRuleForm] = useState({
    days: [] as number[],
    slotStartTime: '08:00',
    slotEndTime: '08:30',
    machineId: '',
    oneSlotDiscount: 0,
    twoSlotDiscount: 0,
    enabled: true,
  });
  const [savingRule, setSavingRule] = useState(false);

  // Payment settings state
  const [paymentSettings, setPaymentSettings] = useState({
    PAYMENT_GATEWAY_ENABLED: false,
    SLOT_PAYMENT_REQUIRED: false,
    PACKAGE_PAYMENT_REQUIRED: false,
    CASH_PAYMENT_ENABLED: false,
    WALLET_ENABLED: false,
  });
  const [paymentLoading, setPaymentLoading] = useState(true);
  const [savingPayment, setSavingPayment] = useState(false);
  const [paymentMessage, setPaymentMessage] = useState({ text: '', type: '' });

  useEffect(() => {
    async function fetchMachineConfig() {
      try {
        const response = await fetch('/api/admin/machine-config');
        if (response.ok) {
          const data = await response.json();
          const pc = data.pricingConfig || DEFAULT_PRICING;
          if (!pc.yantra) {
            pc.yantra = JSON.parse(JSON.stringify(pc.leather || DEFAULT_PRICING.leather));
          }
          if (!pc.yantra_machine) {
            pc.yantra_machine = JSON.parse(JSON.stringify(pc.machine || DEFAULT_PRICING.yantra_machine));
          }
          setMachineConfig({
            ...data,
            pricingConfig: pc,
            timeSlabConfig: data.timeSlabConfig || DEFAULT_TIME_SLABS,
            machinePitchConfig: data.machinePitchConfig || DEFAULT_MACHINE_PITCH_CONFIG,
          });
        }
      } catch (error) {
        console.error('Failed to fetch machine config:', error);
      } finally {
        setMachineLoading(false);
      }
    }

    async function fetchOperators() {
      try {
        const res = await fetch('/api/admin/operators');
        if (res.ok) {
          const data = await res.json();
          setOperators(data.operators || []);
        }
      } catch (error) {
        console.error('Failed to fetch operators:', error);
      }
    }

    async function fetchPaymentSettings() {
      try {
        const res = await fetch('/api/admin/policies');
        if (res.ok) {
          const data = await res.json();
          const policyArray: { key: string; value: string }[] = Array.isArray(data) ? data : (data.policies || []);
          const policies: Record<string, string> = {};
          policyArray.forEach((p) => { policies[p.key] = p.value; });
          setPaymentSettings({
            PAYMENT_GATEWAY_ENABLED: policies['PAYMENT_GATEWAY_ENABLED'] === 'true',
            SLOT_PAYMENT_REQUIRED: policies['SLOT_PAYMENT_REQUIRED'] === 'true',
            PACKAGE_PAYMENT_REQUIRED: policies['PACKAGE_PAYMENT_REQUIRED'] === 'true',
            CASH_PAYMENT_ENABLED: policies['CASH_PAYMENT_ENABLED'] === 'true',
            WALLET_ENABLED: policies['WALLET_ENABLED'] === 'true',
          });
        }
      } catch (error) {
        console.error('Failed to fetch payment settings:', error);
      } finally {
        setPaymentLoading(false);
      }
    }

    fetchMachineConfig();
    fetchOperators();
    fetchPaymentSettings();
    fetchRecurringRules();
    fetchOperatorSchedule();
  }, []);

  // Fetch recurring discount rules
  async function fetchRecurringRules() {
    try {
      const res = await fetch('/api/admin/recurring-discounts');
      if (res.ok) {
        const data = await res.json();
        setRecurringRules(data.rules || []);
      }
    } catch (error) {
      console.error('Failed to fetch recurring rules:', error);
    } finally {
      setRecurringLoading(false);
    }
  }

  // Fetch operator schedule config
  async function fetchOperatorSchedule() {
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
  }

  const handleSavePayment = async (key: string, value: boolean) => {
    setSavingPayment(true);
    setPaymentMessage({ text: '', type: '' });
    try {
      const res = await fetch('/api/admin/policies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value: String(value) }),
      });
      if (!res.ok) throw new Error('Failed to save');
      setPaymentSettings(prev => ({ ...prev, [key]: value }));
      setPaymentMessage({ text: 'Saved', type: 'success' });
      setTimeout(() => setPaymentMessage({ text: '', type: '' }), 2000);
    } catch {
      setPaymentMessage({ text: 'Failed to save', type: 'error' });
    } finally {
      setSavingPayment(false);
    }
  };

  const handleSaveMachine = async () => {
    setSavingMachine(true);
    setMachineMessage({ text: '', type: '' });
    try {
      const res = await fetch('/api/admin/machine-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(machineConfig),
      });
      if (res.ok) {
        setMachineMessage({ text: 'Machine configuration saved', type: 'success' });
      } else {
        const data = await res.json();
        setMachineMessage({ text: data.error || 'Failed to save', type: 'error' });
      }
    } catch {
      setMachineMessage({ text: 'Failed to save configuration', type: 'error' });
    } finally {
      setSavingMachine(false);
    }
  };

  const updatePricing = (path: string[], value: number) => {
    setMachineConfig(prev => {
      const newPricing = JSON.parse(JSON.stringify(prev.pricingConfig));
      let obj: any = newPricing;
      for (let i = 0; i < path.length - 1; i++) {
        obj = obj[path[i]];
      }
      obj[path[path.length - 1]] = value;
      return { ...prev, pricingConfig: newPricing };
    });
  };

  const updateTimeSlab = (slab: 'morning' | 'evening', field: 'start' | 'end', value: string) => {
    setMachineConfig(prev => ({
      ...prev,
      timeSlabConfig: {
        ...prev.timeSlabConfig,
        [slab]: { ...prev.timeSlabConfig[slab], [field]: value },
      },
    }));
  };

  const togglePitchType = (machineId: MachineId, pitchType: PitchType) => {
    setMachineConfig(prev => {
      const current = prev.machinePitchConfig || DEFAULT_MACHINE_PITCH_CONFIG;
      const enabled = current[machineId] || [];
      const isEnabled = enabled.includes(pitchType);
      const updated = isEnabled
        ? enabled.filter(p => p !== pitchType)
        : [...enabled, pitchType];
      return {
        ...prev,
        machinePitchConfig: { ...current, [machineId]: updated },
      };
    });
  };

  const moveOperator = (index: number, direction: 'up' | 'down') => {
    setOperators(prev => {
      const arr = [...prev];
      const swapIndex = direction === 'up' ? index - 1 : index + 1;
      if (swapIndex < 0 || swapIndex >= arr.length) return prev;
      [arr[index], arr[swapIndex]] = [arr[swapIndex], arr[index]];
      return arr;
    });
  };

  const saveOperatorPriority = async () => {
    setSavingPriority(true);
    try {
      const payload = operators.map((op, i) => ({
        userId: op.id,
        priority: operators.length - i,
        morningPriority: op.operatorMorningPriority,
        eveningPriority: op.operatorEveningPriority,
      }));
      const res = await fetch('/api/admin/operators', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operators: payload }),
      });
      if (res.ok) {
        const data = await res.json();
        setOperators(data.operators || []);
        setMachineMessage({ text: 'Operator priority saved', type: 'success' });
      } else {
        const data = await res.json();
        setMachineMessage({ text: data.error || 'Failed to save priority', type: 'error' });
      }
    } catch {
      setMachineMessage({ text: 'Failed to save operator priority', type: 'error' });
    } finally {
      setSavingPriority(false);
    }
  };

  const toggleMachineAssignment = async (operatorId: string, machineId: string, isCurrentlyAssigned: boolean) => {
    const key = `${operatorId}-${machineId}`;
    setTogglingAssignment(key);
    try {
      if (isCurrentlyAssigned) {
        const res = await fetch('/api/admin/operators', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: operatorId, machineId }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to remove assignment');
        }
      } else {
        const res = await fetch('/api/admin/operators', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: operatorId, machineId }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to assign machine');
        }
      }

      const refreshRes = await fetch('/api/admin/operators');
      if (refreshRes.ok) {
        const data = await refreshRes.json();
        setOperators(data.operators || []);
      }
    } catch (err) {
      setMachineMessage({ text: err instanceof Error ? err.message : 'Assignment failed', type: 'error' });
    } finally {
      setTogglingAssignment(null);
    }
  };

  const paymentItems = [
    { key: 'PAYMENT_GATEWAY_ENABLED', label: 'Payment Gateway', desc: 'Enable Razorpay online payments', icon: CreditCard },
    { key: 'SLOT_PAYMENT_REQUIRED', label: 'Require Payment for Slots', desc: 'Users must pay before booking slots', icon: IndianRupee },
    { key: 'PACKAGE_PAYMENT_REQUIRED', label: 'Require Payment for Packages', desc: 'Users must pay when purchasing packages', icon: IndianRupee },
    { key: 'CASH_PAYMENT_ENABLED', label: 'Cash Payment', desc: 'Allow users to pay at center', icon: Banknote },
    { key: 'WALLET_ENABLED', label: 'Wallet', desc: 'Allow wallet balance for payments', icon: Wallet },
  ];

  const inputClass = "w-full bg-white/[0.04] border border-white/[0.1] text-white placeholder:text-slate-500 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition-colors";

  const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DAY_NUMBERS = [0, 1, 2, 3, 4, 5, 6];

  // ─── Operator Schedule Helpers ──────────────────
  const getScheduleCount = (day: number, slab: string) => {
    return operatorSchedule[`${day}-${slab}`] ?? operatorScheduleDefault;
  };

  const setScheduleCount = (day: number, slab: string, count: number) => {
    setOperatorSchedule(prev => ({ ...prev, [`${day}-${slab}`]: Math.max(0, count) }));
  };

  const saveOperatorSchedule = async () => {
    setSavingSchedule(true);
    try {
      // Build schedule entries from the grid
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
      const config = { default: operatorScheduleDefault, schedule };
      const res = await fetch('/api/admin/policies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'OPERATOR_SCHEDULE_CONFIG', value: JSON.stringify(config) }),
      });
      if (res.ok) {
        setMachineMessage({ text: 'Operator schedule saved', type: 'success' });
      } else {
        setMachineMessage({ text: 'Failed to save schedule', type: 'error' });
      }
    } catch {
      setMachineMessage({ text: 'Failed to save schedule', type: 'error' });
    } finally {
      setSavingSchedule(false);
    }
  };

  // ─── Recurring Discount Helpers ─────────────────
  const resetRuleForm = () => {
    setRuleForm({ days: [], slotStartTime: '08:00', slotEndTime: '08:30', machineId: '', oneSlotDiscount: 0, twoSlotDiscount: 0, enabled: true });
    setEditingRule(null);
    setShowAddRule(false);
  };

  const handleSaveRule = async () => {
    setSavingRule(true);
    try {
      const payload = {
        days: ruleForm.days,
        slotStartTime: ruleForm.slotStartTime,
        slotEndTime: ruleForm.slotEndTime,
        machineId: ruleForm.machineId || null,
        oneSlotDiscount: Number(ruleForm.oneSlotDiscount),
        twoSlotDiscount: Number(ruleForm.twoSlotDiscount),
        enabled: ruleForm.enabled,
      };
      let res;
      if (editingRule) {
        res = await fetch(`/api/admin/recurring-discounts/${editingRule.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch('/api/admin/recurring-discounts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
      if (res.ok) {
        resetRuleForm();
        fetchRecurringRules();
        setMachineMessage({ text: editingRule ? 'Rule updated' : 'Rule created', type: 'success' });
      } else {
        const data = await res.json();
        setMachineMessage({ text: data.error || 'Failed to save rule', type: 'error' });
      }
    } catch {
      setMachineMessage({ text: 'Failed to save rule', type: 'error' });
    } finally {
      setSavingRule(false);
    }
  };

  const handleDeleteRule = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/recurring-discounts/${id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchRecurringRules();
        setMachineMessage({ text: 'Rule deleted', type: 'success' });
      }
    } catch {
      setMachineMessage({ text: 'Failed to delete rule', type: 'error' });
    }
  };

  const handleToggleRule = async (rule: RecurringDiscountRule) => {
    try {
      await fetch(`/api/admin/recurring-discounts/${rule.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !rule.enabled }),
      });
      fetchRecurringRules();
    } catch {
      setMachineMessage({ text: 'Failed to toggle rule', type: 'error' });
    }
  };

  const startEditRule = (rule: RecurringDiscountRule) => {
    setRuleForm({
      days: rule.days,
      slotStartTime: rule.slotStartTime,
      slotEndTime: rule.slotEndTime,
      machineId: rule.machineId || '',
      oneSlotDiscount: rule.oneSlotDiscount,
      twoSlotDiscount: rule.twoSlotDiscount,
      enabled: rule.enabled,
    });
    setEditingRule(rule);
    setShowAddRule(true);
  };

  return (
    <div className="space-y-5">
      <AdminPageHeader
        icon={Settings}
        title="Configuration"
        description="Payment, machines & pricing"
      />

      {/* ─── Payment Settings ─────────────────────── */}
      <AdminCard
        title="Payment Settings"
        icon={<CreditCard className="w-4 h-4 text-accent" />}
        collapsible
        defaultOpen={true}
        headerRight={
          paymentMessage.text ? (
            <span className={`text-xs font-medium ${paymentMessage.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
              {paymentMessage.text}
            </span>
          ) : undefined
        }
      >
        {paymentLoading ? (
          <div className="flex items-center gap-2 py-4 text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Loading payment settings...</span>
          </div>
        ) : (
          <div className="space-y-0.5">
            {paymentItems.map(({ key, label, desc, icon }) => (
              <AdminToggle
                key={key}
                enabled={paymentSettings[key as keyof typeof paymentSettings]}
                onToggle={() => handleSavePayment(key, !paymentSettings[key as keyof typeof paymentSettings])}
                label={label}
                description={desc}
                icon={icon}
                disabled={savingPayment}
              />
            ))}
          </div>
        )}
      </AdminCard>

      {/* ─── Machine Configuration ────────────────── */}
      <AdminCard
        title="Machine Configuration"
        icon={<Zap className="w-4 h-4 text-accent" />}
        collapsible
        defaultOpen={true}
      >
        {machineLoading ? (
          <div className="flex items-center justify-center py-8 text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            <span className="text-sm">Loading configuration...</span>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Leather Ball Machine */}
            <div className="bg-white/[0.02] rounded-xl border border-white/[0.05] p-4">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-red-400" />
                Leather Ball Machine
              </h3>
              <div className="space-y-0.5">
                <AdminToggle
                  enabled={machineConfig.leatherMachine.ballTypeSelectionEnabled}
                  onToggle={() => setMachineConfig(prev => ({
                    ...prev,
                    leatherMachine: { ...prev.leatherMachine, ballTypeSelectionEnabled: !prev.leatherMachine.ballTypeSelectionEnabled },
                  }))}
                  label="Ball Type Selection"
                  description="Users choose between Leather Ball and Machine Ball"
                  size="sm"
                />
                <AdminToggle
                  enabled={machineConfig.leatherMachine.pitchTypeSelectionEnabled}
                  onToggle={() => setMachineConfig(prev => ({
                    ...prev,
                    leatherMachine: { ...prev.leatherMachine, pitchTypeSelectionEnabled: !prev.leatherMachine.pitchTypeSelectionEnabled },
                  }))}
                  label="Pitch Type Selection"
                  description="Select between Astro Turf, Cement, and Natural Turf"
                  size="sm"
                />
              </div>
            </div>

            {/* Tennis Ball Machine */}
            <div className="bg-white/[0.02] rounded-xl border border-white/[0.05] p-4">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-400" />
                Tennis Ball Machine
              </h3>
              <AdminToggle
                enabled={machineConfig.tennisMachine.pitchTypeSelectionEnabled}
                onToggle={() => setMachineConfig(prev => ({
                  ...prev,
                  tennisMachine: { ...prev.tennisMachine, pitchTypeSelectionEnabled: !prev.tennisMachine.pitchTypeSelectionEnabled },
                }))}
                label="Pitch Type Selection"
                description="Select between Astro Turf, Cement, and Natural Turf"
                size="sm"
              />
            </div>

            {/* Machine-Pitch Compatibility */}
            <div className="bg-white/[0.02] rounded-xl border border-white/[0.05] p-4">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-1">Machine — Pitch Compatibility</h3>
              <p className="text-[10px] text-slate-500 mb-3">Toggle which pitch types are available for each machine</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {ALL_MACHINE_IDS.map(machineId => {
                  const label = MACHINE_LABELS[machineId];
                  const enabled = machineConfig.machinePitchConfig?.[machineId] || [];
                  return (
                    <div key={machineId} className="bg-white/[0.02] rounded-xl p-3 border border-white/[0.05]">
                      <div className="flex items-center gap-2 mb-2.5">
                        <span className={`w-2 h-2 rounded-full ${label.category === 'Leather' ? 'bg-red-400' : 'bg-green-400'}`} />
                        <p className="text-[11px] font-bold text-slate-300">{label.name}</p>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {ALL_PITCH_TYPES.map(pt => {
                          const isOn = enabled.includes(pt);
                          return (
                            <button
                              key={pt}
                              onClick={() => togglePitchType(machineId, pt)}
                              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all cursor-pointer ${isOn
                                  ? 'bg-accent/15 text-accent border border-accent/30'
                                  : 'bg-white/[0.04] text-slate-500 border border-white/[0.08] hover:bg-white/[0.08]'
                                }`}
                            >
                              {isOn && <Check className="w-3 h-3" />}
                              {PITCH_TYPE_LABELS[pt]}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Operator Configuration */}
            <div className="bg-white/[0.02] rounded-xl border border-white/[0.05] p-4">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3">Operator Configuration</h3>

              {/* Operator Schedule Grid (Feature 3) */}
              <div className="mb-4">
                <p className="text-sm font-medium text-slate-300">Operator Schedule</p>
                <p className="text-[10px] text-slate-500 mb-3">Set how many operators are needed per day and time slab</p>
                
                <div className="mb-3">
                  <label className="block text-[10px] font-medium text-slate-400 mb-1">Default Count</label>
                  <input
                    type="number"
                    value={operatorScheduleDefault}
                    onChange={e => setOperatorScheduleDefault(Math.max(1, Math.floor(Number(e.target.value))))}
                    min="1"
                    className="w-24 bg-white/[0.04] border border-white/[0.1] text-white rounded-lg px-3 py-2 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition-colors"
                  />
                </div>

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
                            <input
                              type="number"
                              value={getScheduleCount(day, 'morning')}
                              onChange={e => setScheduleCount(day, 'morning', Number(e.target.value))}
                              min="0"
                              className="w-14 bg-white/[0.04] border border-white/[0.1] text-white text-center rounded-lg px-1 py-1 text-[11px] outline-none focus:border-accent"
                            />
                          </td>
                          <td className="text-center py-1.5 px-2">
                            <input
                              type="number"
                              value={getScheduleCount(day, 'evening')}
                              onChange={e => setScheduleCount(day, 'evening', Number(e.target.value))}
                              min="0"
                              className="w-14 bg-white/[0.04] border border-white/[0.1] text-white text-center rounded-lg px-1 py-1 text-[11px] outline-none focus:border-accent"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button
                  onClick={saveOperatorSchedule}
                  disabled={savingSchedule}
                  className="mt-2 inline-flex items-center gap-1.5 bg-accent/10 hover:bg-accent/20 text-accent px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
                >
                  {savingSchedule ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                  Save Schedule
                </button>
              </div>

              {/* Operator Priority (Feature 2 — Morning/Evening) */}
              <div className="mt-4">
                <p className="text-sm font-medium text-slate-300">Operator Priority</p>
                <p className="text-[10px] text-slate-500 mb-1">Set separate priorities for morning and evening sessions. Higher = gets booking first.</p>
                <p className="text-[9px] text-slate-600 mb-3">Morning: {machineConfig.timeSlabConfig.morning.start}–{machineConfig.timeSlabConfig.morning.end} | Evening: {machineConfig.timeSlabConfig.evening.start}–{machineConfig.timeSlabConfig.evening.end}</p>
                {operators.length === 0 ? (
                  <p className="text-xs text-slate-500 italic">No operators found. Assign OPERATOR role to users first.</p>
                ) : (
                  <div className="space-y-2.5">
                    {operators.map((op, index) => {
                      const assignedMachines = new Set(
                        (op.operatorAssignments || []).map(a => a.machineId)
                      );

                      return (
                        <div
                          key={op.id}
                          className="bg-white/[0.03] border border-white/[0.07] rounded-xl px-3 py-3 hover:border-white/[0.12] transition-colors"
                        >
                          <div className="flex items-center gap-3 mb-2">
                            <span className="w-6 h-6 rounded-lg bg-accent/15 flex items-center justify-center text-[10px] font-bold text-accent flex-shrink-0">
                              {index + 1}
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-white truncate">{op.name || 'Unnamed'}</p>
                              <p className="text-[10px] text-slate-500 truncate">{op.email || op.mobileNumber || op.id.slice(0, 8)}</p>
                            </div>
                            <div className="flex flex-col gap-0.5">
                              <button
                                onClick={() => moveOperator(index, 'up')}
                                disabled={index === 0}
                                className="p-1 text-slate-400 hover:text-white disabled:opacity-20 disabled:cursor-not-allowed cursor-pointer transition-colors"
                              >
                                <ChevronUp className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => moveOperator(index, 'down')}
                                disabled={index === operators.length - 1}
                                className="p-1 text-slate-400 hover:text-white disabled:opacity-20 disabled:cursor-not-allowed cursor-pointer transition-colors"
                              >
                                <ChevronDown className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          {/* Morning/Evening Priority Inputs */}
                          <div className="ml-0 sm:ml-9 grid grid-cols-2 gap-2 mb-2">
                            <div>
                              <label className="block text-[9px] font-medium text-amber-400 mb-0.5">☀ Morning Priority</label>
                              <input
                                type="number"
                                value={op.operatorMorningPriority}
                                onChange={e => {
                                  const val = Number(e.target.value);
                                  setOperators(prev => prev.map(o => o.id === op.id ? { ...o, operatorMorningPriority: val } : o));
                                }}
                                min="0"
                                className="w-full bg-white/[0.04] border border-white/[0.1] text-white rounded-lg px-2 py-1.5 text-[11px] outline-none focus:border-accent"
                              />
                            </div>
                            <div>
                              <label className="block text-[9px] font-medium text-indigo-400 mb-0.5">🌙 Evening Priority</label>
                              <input
                                type="number"
                                value={op.operatorEveningPriority}
                                onChange={e => {
                                  const val = Number(e.target.value);
                                  setOperators(prev => prev.map(o => o.id === op.id ? { ...o, operatorEveningPriority: val } : o));
                                }}
                                min="0"
                                className="w-full bg-white/[0.04] border border-white/[0.1] text-white rounded-lg px-2 py-1.5 text-[11px] outline-none focus:border-accent"
                              />
                            </div>
                          </div>

                          {/* Machine Assignments */}
                          <div className="ml-0 sm:ml-9 mt-2 sm:mt-0">
                            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">Assigned Machines</p>
                            <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-1.5">
                              {ALL_MACHINE_IDS.map(mid => {
                                const isAssigned = assignedMachines.has(mid);
                                const isToggling = togglingAssignment === `${op.id}-${mid}`;
                                const shortName = mid === 'GRAVITY' ? 'Gravity' : mid === 'YANTRA' ? 'Yantra' : mid === 'LEVERAGE_INDOOR' ? 'Lev. Indoor' : 'Lev. Outdoor';
                                return (
                                  <button
                                    key={mid}
                                    onClick={() => toggleMachineAssignment(op.id, mid, isAssigned)}
                                    disabled={!!togglingAssignment}
                                    className={`flex items-center justify-center gap-1 px-2 py-2 sm:py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer disabled:opacity-60 ${isAssigned
                                        ? 'bg-accent/15 text-accent border border-accent/30'
                                        : 'bg-white/[0.04] text-slate-500 border border-white/[0.08] hover:bg-white/[0.08]'
                                      }`}
                                  >
                                    {isToggling ? (
                                      <Loader2 className="w-3 h-3 animate-spin" />
                                    ) : isAssigned ? (
                                      <Check className="w-3 h-3" />
                                    ) : null}
                                    <span className="sm:hidden">{shortName}</span>
                                    <span className="hidden sm:inline">{MACHINE_LABELS[mid].name}</span>
                                  </button>
                                );
                              })}
                            </div>
                            {assignedMachines.size === 0 && (
                              <p className="text-[10px] text-amber-400/70 mt-1 italic">No machines assigned — operator won&apos;t receive auto-assignments</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    <button
                      onClick={saveOperatorPriority}
                      disabled={savingPriority}
                      className="mt-2 inline-flex items-center gap-1.5 bg-accent/10 hover:bg-accent/20 text-accent px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {savingPriority ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                      Save Priority
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Time Slab Configuration */}
            <div className="bg-white/[0.02] rounded-xl border border-white/[0.05] p-4">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3">Slot Timing Configuration</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-white/[0.02] rounded-xl p-3 border border-white/[0.05]">
                  <p className="text-[11px] font-bold text-slate-300 mb-2 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                    Morning Slab
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] font-medium text-slate-400 mb-1">Start</label>
                      <input
                        type="time"
                        value={machineConfig.timeSlabConfig.morning.start}
                        onChange={e => updateTimeSlab('morning', 'start', e.target.value)}
                        step="1800"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-medium text-slate-400 mb-1">End</label>
                      <input
                        type="time"
                        value={machineConfig.timeSlabConfig.morning.end}
                        onChange={e => updateTimeSlab('morning', 'end', e.target.value)}
                        step="1800"
                        className={inputClass}
                      />
                    </div>
                  </div>
                </div>
                <div className="bg-white/[0.02] rounded-xl p-3 border border-white/[0.05]">
                  <p className="text-[11px] font-bold text-slate-300 mb-2 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                    Evening Slab
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] font-medium text-slate-400 mb-1">Start</label>
                      <input
                        type="time"
                        value={machineConfig.timeSlabConfig.evening.start}
                        onChange={e => updateTimeSlab('evening', 'start', e.target.value)}
                        step="1800"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-medium text-slate-400 mb-1">End</label>
                      <input
                        type="time"
                        value={machineConfig.timeSlabConfig.evening.end}
                        onChange={e => updateTimeSlab('evening', 'end', e.target.value)}
                        step="1800"
                        className={inputClass}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Pricing Configuration - Tabbed */}
            <div className="bg-white/[0.02] rounded-xl border border-white/[0.05] p-4">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3">Slot Pricing Configuration</h3>

              {/* Tab Selector */}
              <div className="flex gap-1 overflow-x-auto pb-3 mb-3 scrollbar-hide">
                {PRICING_TABS.map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setActivePricingTab(tab.key)}
                    className={`flex-shrink-0 px-3 py-2 rounded-lg text-[11px] font-semibold transition-all cursor-pointer whitespace-nowrap ${activePricingTab === tab.key
                        ? 'bg-accent/15 text-accent border border-accent/30'
                        : 'bg-white/[0.03] text-slate-500 border border-white/[0.06] hover:text-slate-300'
                      }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Active Tab Content */}
              {(['ASTRO', 'CEMENT', 'NATURAL'] as const).map(pitch => {
                const pitchPricing = machineConfig.pricingConfig?.[activePricingTab as keyof PricingConfig]?.[pitch];
                if (!pitchPricing) return null;

                return (
                  <div key={`${activePricingTab}-${pitch}`} className="bg-white/[0.02] rounded-xl p-3 border border-white/[0.05] mb-2.5">
                    <p className="text-[11px] font-bold text-slate-300 mb-2">
                      {pitch === 'ASTRO' ? 'Astro Turf' : pitch === 'CEMENT' ? 'Cement Wicket' : 'Natural Turf'}
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <PriceField
                        label="Morn / Slot"
                        value={pitchPricing.morning.single}
                        onChange={v => updatePricing([activePricingTab, pitch, 'morning', 'single'], v)}
                      />
                      <PriceField
                        label="Morn / 2 Cons."
                        value={pitchPricing.morning.consecutive}
                        onChange={v => updatePricing([activePricingTab, pitch, 'morning', 'consecutive'], v)}
                      />
                      <PriceField
                        label="Eve / Slot"
                        value={pitchPricing.evening.single}
                        onChange={v => updatePricing([activePricingTab, pitch, 'evening', 'single'], v)}
                      />
                      <PriceField
                        label="Eve / 2 Cons."
                        value={pitchPricing.evening.consecutive}
                        onChange={v => updatePricing([activePricingTab, pitch, 'evening', 'consecutive'], v)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Save Button */}
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={() => setShowMachineConfigConfirm(true)}
                disabled={savingMachine}
                className="inline-flex items-center gap-2 bg-accent hover:bg-accent-light text-primary px-5 py-2.5 rounded-xl text-sm font-semibold transition-all cursor-pointer disabled:opacity-50 shadow-sm shadow-accent/20 hover:shadow-accent/30"
              >
                {savingMachine ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save Machine Config
              </button>
              {machineMessage.text && (
                <span className={`text-sm font-medium ${machineMessage.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                  {machineMessage.text}
                </span>
              )}
            </div>
          </div>
        )}
      </AdminCard>

      {/* Machine Config Save Confirmation */}
      <ConfirmDialog
        open={showMachineConfigConfirm}
        title="Save Machine Configuration"
        message="Are you sure you want to save these configuration changes?"
        confirmLabel="Save"
        cancelLabel="Cancel"
        loading={savingMachine}
        onConfirm={() => {
          setShowMachineConfigConfirm(false);
          handleSaveMachine();
        }}
        onCancel={() => setShowMachineConfigConfirm(false)}
      />

      {/* ─── Recurring Slot Discounts (Feature 1) ──── */}
      <AdminCard
        title="Recurring Slot Discounts"
        icon={<Tag className="w-4 h-4 text-emerald-400" />}
        collapsible
        defaultOpen={false}
        subtitle="Fixed discounts for specific day + time combinations"
      >
        {recurringLoading ? (
          <div className="flex items-center gap-2 py-4 text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Loading discount rules...</span>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Existing Rules */}
            {recurringRules.length === 0 && !showAddRule && (
              <p className="text-xs text-slate-500 italic">No recurring discount rules configured.</p>
            )}
            {recurringRules.map(rule => (
              <div key={rule.id} className={`bg-white/[0.02] rounded-xl border p-3 ${rule.enabled ? 'border-emerald-500/20' : 'border-white/[0.05] opacity-60'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap gap-1 mb-1">
                      {rule.days.map(d => (
                        <span key={d} className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-accent/10 text-accent">{DAY_LABELS[d]}</span>
                      ))}
                    </div>
                    <p className="text-xs text-slate-300">
                      {rule.slotStartTime} – {rule.slotEndTime}
                      {rule.machineId && <span className="text-slate-500 ml-2">({MACHINE_LABELS[rule.machineId as MachineId]?.name || rule.machineId})</span>}
                    </p>
                    <div className="flex gap-3 mt-1">
                      <span className="text-[10px] text-emerald-400">1 slot: -₹{rule.oneSlotDiscount}</span>
                      <span className="text-[10px] text-emerald-400">2 slots: -₹{rule.twoSlotDiscount}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => handleToggleRule(rule)}
                      className={`p-1.5 rounded-lg text-[10px] font-medium cursor-pointer ${rule.enabled ? 'text-emerald-400 bg-emerald-400/10' : 'text-slate-500 bg-white/[0.04]'}`}
                    >{rule.enabled ? 'ON' : 'OFF'}</button>
                    <button onClick={() => startEditRule(rule)} className="p-1.5 rounded-lg text-slate-400 hover:text-accent hover:bg-accent/10 cursor-pointer"><Edit2 className="w-3 h-3" /></button>
                    <button onClick={() => handleDeleteRule(rule.id)} className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-400/10 cursor-pointer"><Trash2 className="w-3 h-3" /></button>
                  </div>
                </div>
              </div>
            ))}

            {/* Add/Edit Rule Form */}
            {showAddRule ? (
              <div className="bg-white/[0.03] rounded-xl border border-accent/20 p-4 space-y-3">
                <h4 className="text-xs font-bold text-accent">{editingRule ? 'Edit Rule' : 'New Rule'}</h4>

                {/* Days Multi-Select */}
                <div>
                  <label className="block text-[10px] font-medium text-slate-400 mb-1">Days of Week</label>
                  <div className="flex flex-wrap gap-1">
                    {DAY_NUMBERS.map(d => (
                      <button
                        key={d}
                        onClick={() => {
                          setRuleForm(prev => ({
                            ...prev,
                            days: prev.days.includes(d) ? prev.days.filter(x => x !== d) : [...prev.days, d],
                          }));
                        }}
                        className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all cursor-pointer ${
                          ruleForm.days.includes(d)
                            ? 'bg-accent/15 text-accent border border-accent/30'
                            : 'bg-white/[0.04] text-slate-500 border border-white/[0.08] hover:bg-white/[0.08]'
                        }`}
                      >{DAY_LABELS[d]}</button>
                    ))}
                  </div>
                </div>

                {/* Time */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-medium text-slate-400 mb-1">Start Time</label>
                    <input type="time" value={ruleForm.slotStartTime} onChange={e => setRuleForm(prev => ({ ...prev, slotStartTime: e.target.value }))} step="1800" className={inputClass} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-slate-400 mb-1">End Time</label>
                    <input type="time" value={ruleForm.slotEndTime} onChange={e => setRuleForm(prev => ({ ...prev, slotEndTime: e.target.value }))} step="1800" className={inputClass} />
                  </div>
                </div>

                {/* Machine */}
                <div>
                  <label className="block text-[10px] font-medium text-slate-400 mb-1">Machine (optional)</label>
                  <select
                    value={ruleForm.machineId}
                    onChange={e => setRuleForm(prev => ({ ...prev, machineId: e.target.value }))}
                    className={inputClass}
                  >
                    <option value="">All Machines</option>
                    {ALL_MACHINE_IDS.map(mid => (
                      <option key={mid} value={mid}>{MACHINE_LABELS[mid].name}</option>
                    ))}
                  </select>
                </div>

                {/* Discount Amounts */}
                <div className="grid grid-cols-2 gap-2">
                  <PriceField
                    label="Discount for 1 Slot (₹)"
                    value={ruleForm.oneSlotDiscount}
                    onChange={v => setRuleForm(prev => ({ ...prev, oneSlotDiscount: v }))}
                  />
                  <PriceField
                    label="Discount for 2 Cons. Slots (₹)"
                    value={ruleForm.twoSlotDiscount}
                    onChange={v => setRuleForm(prev => ({ ...prev, twoSlotDiscount: v }))}
                  />
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={handleSaveRule}
                    disabled={savingRule || ruleForm.days.length === 0}
                    className="inline-flex items-center gap-1.5 bg-accent/10 hover:bg-accent/20 text-accent px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {savingRule ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                    {editingRule ? 'Update' : 'Save Rule'}
                  </button>
                  <button
                    onClick={resetRuleForm}
                    className="text-xs text-slate-500 hover:text-slate-300 px-3 py-1.5 cursor-pointer"
                  >Cancel</button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowAddRule(true)}
                className="inline-flex items-center gap-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Discount Rule
              </button>
            )}
          </div>
        )}
      </AdminCard>
    </div>
  );
}
