'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Settings, IndianRupee, Save, Loader2, Zap, Check, CreditCard, Banknote, Wallet, ShoppingBag } from 'lucide-react';
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
  GRAVITY: { name: 'Gravity', category: 'Leather' },
  YANTRA: { name: 'Yantra', category: 'Leather' },
  LEVERAGE_INDOOR: { name: 'Leverage Tennis (Indoor)', category: 'Tennis' },
  LEVERAGE_OUTDOOR: { name: 'Leverage Tennis (Outdoor)', category: 'Tennis' },
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
  useSession(); // ensure auth context is available

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
  const [activePricingTab, setActivePricingTab] = useState<string>('leather');


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

  // Kit Rental Config state
  const [kitRentalConfig, setKitRentalConfig] = useState({
    enabled: false,
    price: 200,
    title: 'Cricket Kit & Bat Rental',
    description: 'Rent cricket kit and bat for your session',
    note: 'Any damages to the bat will be chargeable',
    machines: ['GRAVITY', 'YANTRA'] as string[],
  });
  const [savingKitRental, setSavingKitRental] = useState(false);
  const [kitRentalMessage, setKitRentalMessage] = useState({ text: '', type: '' });

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
          // Load kit rental config
          if (policies['KIT_RENTAL_CONFIG']) {
            try {
              const parsed = JSON.parse(policies['KIT_RENTAL_CONFIG']);
              setKitRentalConfig(prev => ({ ...prev, ...parsed }));
            } catch { /* use defaults */ }
          }
        }
      } catch (error) {
        console.error('Failed to fetch payment settings:', error);
      } finally {
        setPaymentLoading(false);
      }
    }

    fetchMachineConfig();
    fetchPaymentSettings();
  }, []);


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

  const handleSaveKitRental = async (updatedConfig?: typeof kitRentalConfig) => {
    const configToSave = updatedConfig || kitRentalConfig;
    setSavingKitRental(true);
    setKitRentalMessage({ text: '', type: '' });
    try {
      const res = await fetch('/api/admin/policies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'KIT_RENTAL_CONFIG', value: JSON.stringify(configToSave) }),
      });
      if (!res.ok) throw new Error('Failed to save');
      setKitRentalConfig(configToSave);
      setKitRentalMessage({ text: 'Saved', type: 'success' });
      setTimeout(() => setKitRentalMessage({ text: '', type: '' }), 2000);
    } catch {
      setKitRentalMessage({ text: 'Failed to save', type: 'error' });
    } finally {
      setSavingKitRental(false);
    }
  };

  const handleSaveMachine = async () => {
    setSavingMachine(true);
    setMachineMessage({ text: '', type: '' });
    const errors: string[] = [];
    try {
      // 1. Save machine config (pricing, time slabs, machine-pitch config)
      const machineRes = await fetch('/api/admin/machine-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(machineConfig),
      });
      if (!machineRes.ok) {
        const data = await machineRes.json();
        errors.push(data.error || 'Failed to save machine config');
      }

      if (errors.length > 0) {
        setMachineMessage({ text: errors.join('; '), type: 'error' });
      } else {
        setMachineMessage({ text: 'All configuration saved successfully', type: 'success' });
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

  const paymentItems = [
    { key: 'PAYMENT_GATEWAY_ENABLED', label: 'Payment Gateway', desc: 'Enable Razorpay online payments', icon: CreditCard },
    { key: 'SLOT_PAYMENT_REQUIRED', label: 'Require Payment for Slots', desc: 'Users must pay before booking slots', icon: IndianRupee },
    { key: 'PACKAGE_PAYMENT_REQUIRED', label: 'Require Payment for Packages', desc: 'Users must pay when purchasing packages', icon: IndianRupee },
    { key: 'CASH_PAYMENT_ENABLED', label: 'Cash Payment', desc: 'Allow users to pay at center', icon: Banknote },
    { key: 'WALLET_ENABLED', label: 'Wallet', desc: 'Allow wallet balance for payments', icon: Wallet },
  ];

  const inputClass = "w-full bg-white/[0.04] border border-white/[0.1] text-white placeholder:text-slate-500 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition-colors";

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

      {/* ─── Kit Rental Settings ─────────────────── */}
      <AdminCard
        title="Kit Rental Settings"
        icon={<ShoppingBag className="w-4 h-4 text-accent" />}
        collapsible
        defaultOpen={false}
        headerRight={
          kitRentalMessage.text ? (
            <span className={`text-xs font-medium ${kitRentalMessage.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
              {kitRentalMessage.text}
            </span>
          ) : undefined
        }
      >
        <div className="space-y-4">
          {/* Enable/Disable Toggle */}
          <AdminToggle
            enabled={kitRentalConfig.enabled}
            onToggle={() => {
              const updated = { ...kitRentalConfig, enabled: !kitRentalConfig.enabled };
              setKitRentalConfig(updated);
              handleSaveKitRental(updated);
            }}
            label="Enable Kit Rental"
            description="Show kit rental option on booking page for selected machines"
            icon={ShoppingBag}
            disabled={savingKitRental}
          />

          {kitRentalConfig.enabled && (
            <div className="space-y-3 pt-2">
              {/* Price */}
              <div>
                <label className="block text-[10px] font-medium text-slate-400 mb-1 uppercase tracking-wider">Rental Price (per session)</label>
                <div className="relative max-w-xs">
                  <IndianRupee className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500" />
                  <input
                    type="number"
                    min="0"
                    value={kitRentalConfig.price}
                    onChange={e => setKitRentalConfig(prev => ({ ...prev, price: Math.max(0, Number(e.target.value)) }))}
                    className={inputClass + ' pl-7 max-w-xs'}
                  />
                </div>
              </div>

              {/* Title */}
              <div>
                <label className="block text-[10px] font-medium text-slate-400 mb-1 uppercase tracking-wider">Title</label>
                <input
                  type="text"
                  value={kitRentalConfig.title}
                  onChange={e => setKitRentalConfig(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="e.g., Cricket Kit & Bat Rental"
                  className={inputClass}
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-[10px] font-medium text-slate-400 mb-1 uppercase tracking-wider">Description</label>
                <input
                  type="text"
                  value={kitRentalConfig.description}
                  onChange={e => setKitRentalConfig(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="e.g., Rent cricket kit and bat for your session"
                  className={inputClass}
                />
              </div>

              {/* Note/Warning */}
              <div>
                <label className="block text-[10px] font-medium text-slate-400 mb-1 uppercase tracking-wider">Note / Warning</label>
                <input
                  type="text"
                  value={kitRentalConfig.note}
                  onChange={e => setKitRentalConfig(prev => ({ ...prev, note: e.target.value }))}
                  placeholder="e.g., Any damages to the bat will be chargeable"
                  className={inputClass}
                />
              </div>

              {/* Applicable Machines */}
              <div>
                <label className="block text-[10px] font-medium text-slate-400 mb-2 uppercase tracking-wider">Applicable Machines</label>
                <div className="grid grid-cols-2 gap-2">
                  {ALL_MACHINE_IDS.map(mid => {
                    const isSelected = kitRentalConfig.machines.includes(mid);
                    return (
                      <button
                        key={mid}
                        type="button"
                        onClick={() => {
                          setKitRentalConfig(prev => ({
                            ...prev,
                            machines: isSelected
                              ? prev.machines.filter(m => m !== mid)
                              : [...prev.machines, mid],
                          }));
                        }}
                        className={`flex items-center gap-2 p-2.5 rounded-xl text-left transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-accent/10 ring-1 ring-accent/30'
                            : 'bg-white/[0.03] border border-white/[0.06] hover:border-white/[0.12]'
                        }`}
                      >
                        <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                          isSelected ? 'bg-accent border-accent' : 'border-slate-600'
                        }`}>
                          {isSelected && <Check className="w-2.5 h-2.5 text-primary" />}
                        </span>
                        <span className={`text-xs font-medium ${isSelected ? 'text-accent' : 'text-slate-400'}`}>
                          {MACHINE_LABELS[mid].name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Save Button */}
              <button
                onClick={() => handleSaveKitRental()}
                disabled={savingKitRental}
                className="inline-flex items-center gap-2 bg-accent/15 hover:bg-accent/25 text-accent border border-accent/25 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all cursor-pointer disabled:opacity-40"
              >
                {savingKitRental ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {savingKitRental ? 'Saving...' : 'Save Kit Rental Settings'}
              </button>
            </div>
          )}
        </div>
      </AdminCard>

      {/* ─── Machine Configuration ────────────────── */}
      <AdminCard
        title="Machine Configuration"
        icon={<Zap className="w-4 h-4 text-accent" />}
        collapsible
        defaultOpen={false}
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

            {/* Save button moved to bottom of page */}
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


      {/* ─── Unified Save Button (bottom of page) ─── */}
      <div className="sticky bottom-4 z-40 flex items-center gap-3 p-4 rounded-2xl bg-[#0b1726]/95 backdrop-blur-xl border border-white/[0.08] shadow-xl shadow-black/30">
        <button
          onClick={() => setShowMachineConfigConfirm(true)}
          disabled={savingMachine}
          className="inline-flex items-center gap-2 bg-accent hover:bg-accent-light text-primary px-6 py-3 rounded-xl text-sm font-semibold transition-all cursor-pointer disabled:opacity-50 shadow-sm shadow-accent/20 hover:shadow-accent/30"
        >
          {savingMachine ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Machine Configuration
        </button>
        {machineMessage.text && (
          <span className={`text-sm font-medium ${machineMessage.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
            {machineMessage.text}
          </span>
        )}
      </div>
    </div>
  );
}
