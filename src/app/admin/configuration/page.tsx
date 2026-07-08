'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Settings, IndianRupee, Save, Loader2, Zap, Check, CreditCard, Banknote, Wallet, ShoppingBag } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { AdminCard } from '@/components/admin/AdminCard';
import { AdminToggle } from '@/components/admin/AdminToggle';
import { useCenter } from '@/lib/center-context';
import { ResourcePricingEditor } from '@/components/admin/ResourcePricingEditor';
import { EnabledCategoriesEditor } from '@/components/admin/EnabledCategoriesEditor';
import { MatchPracticeConfigEditor } from '@/components/admin/MatchPracticeConfigEditor';
import { EnabledPitchTypesEditor } from '@/components/admin/EnabledPitchTypesEditor';
import { Ticket } from 'lucide-react';

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

// Kept in sync with src/lib/pricing.ts → DEFAULT_TIME_SLABS so the
// admin form pre-populates with the same continuous slabs the engine
// uses when CenterPolicy isn't set. The previous 17:00–19:00 gap left
// resource-based centers with no bookable slots in that window.
const DEFAULT_TIME_SLABS: TimeSlabConfig = {
  morning: { start: '07:00', end: '17:00' },
  evening: { start: '17:00', end: '22:30' },
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
  LEVERAGE_INDOOR: { name: 'iWinner (Indoor)', category: 'Tennis' },
  LEVERAGE_OUTDOOR: { name: 'iWinner (Outdoor)', category: 'Tennis' },
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
  const { currentCenter } = useCenter();
  // Settings are always edited at the center scope. The global-defaults
  // toggle was removed because it confused admins more than it helped —
  // every center now manages its own values via this page, and the
  // platform default is whatever ships in code.
  const scope = 'center' as const;

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

  // Unified Settings state. A single counter (`settingsSaveTrigger`)
  // drives the trigger-based child editors (Booking Categories, Pitch
  // Types, Resource Pricing); each reports its save status back so the
  // page can surface a combined message next to the global Save button.
  const [settingsSaveTrigger, setSettingsSaveTrigger] = useState(0);
  const [categoriesSaveStatus, setCategoriesSaveStatus] = useState<{ saving: boolean; message: { text: string; ok: boolean } | null }>({ saving: false, message: null });
  const [pitchTypesSaveStatus, setPitchTypesSaveStatus] = useState<{ saving: boolean; message: { text: string; ok: boolean } | null }>({ saving: false, message: null });
  const [resourcePricingSaveStatus, setResourcePricingSaveStatus] = useState<{ saving: boolean; message: { text: string; ok: boolean } | null }>({ saving: false, message: null });
  const [matchPracticeSaveStatus, setMatchPracticeSaveStatus] = useState<{ saving: boolean; message: { text: string; ok: boolean } | null }>({ saving: false, message: null });
  const isSettingsSaving = categoriesSaveStatus.saving || pitchTypesSaveStatus.saving || resourcePricingSaveStatus.saving || matchPracticeSaveStatus.saving;
  const settingsError =
    [categoriesSaveStatus, pitchTypesSaveStatus, resourcePricingSaveStatus, matchPracticeSaveStatus]
      .map((s) => s.message)
      .find((m) => m && !m.ok) ?? null;


  // Payment settings state
  // BALL_TYPE_SELECTION_ENABLED / PITCH_TYPE_SELECTION_ENABLED default
  // to `true` — the chip rows are visible unless the admin opts out.
  // The cascade in /api/admin/policies returns the stored string
  // ("true" / "false") and we coerce below.
  const [paymentSettings, setPaymentSettings] = useState({
    PAYMENT_GATEWAY_ENABLED: false,
    SLOT_PAYMENT_REQUIRED: false,
    PACKAGE_PAYMENT_REQUIRED: false,
    CASH_PAYMENT_ENABLED: false,
    WALLET_ENABLED: false,
    BALL_TYPE_SELECTION_ENABLED: true,
    PITCH_TYPE_SELECTION_ENABLED: true,
  });
  const [paymentLoading, setPaymentLoading] = useState(true);
  const [savingPayment, setSavingPayment] = useState(false);
  const [paymentMessage, setPaymentMessage] = useState({ text: '', type: '' });

  // Kit Rental Config state. `machineRowConfigs` is a Toplay (and
  // future RESOURCE_BASED center) extension: instead of one global
  // price + an ABCA enum allowlist, each Machine row at the center
  // gets its own enabled + price config. The global `price` /
  // `machines` fields remain for back-compat with ABCA-style centers.
  const [kitRentalConfig, setKitRentalConfig] = useState<{
    enabled: boolean;
    price: number;
    title: string;
    description: string;
    note: string;
    machines: string[];
    machineRowConfigs?: Record<string, { enabled: boolean; price: number }>;
  }>({
    enabled: false,
    price: 200,
    title: 'Cricket Kit & Bat Rental',
    description: 'Rent cricket kit and bat for your session',
    note: 'Any damages to the bat will be chargeable',
    machines: ['GRAVITY', 'YANTRA'],
    machineRowConfigs: {},
  });
  // Live Machine rows at the current center — used by the per-machine
  // kit rental editor (resource-based centers only). Fetched alongside
  // the policies effect when the active center is resource-based.
  const [centerMachines, setCenterMachines] = useState<Array<{
    id: string;
    name: string;
    shortName: string | null;
    isActive: boolean;
    machineType: { code: string; name: string; ballType: string };
  }>>([]);

  useEffect(() => {
    async function fetchMachineConfig() {
      try {
        const response = await fetch(`/api/admin/machine-config?scope=${scope}`);
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
        const res = await fetch(`/api/admin/policies?scope=${scope}`);
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
            // Selector toggles default to TRUE when unset — the chip
            // rows show unless the admin has explicitly stored "false".
            BALL_TYPE_SELECTION_ENABLED:
              policies['BALL_TYPE_SELECTION_ENABLED'] === undefined
                ? true
                : policies['BALL_TYPE_SELECTION_ENABLED'] === 'true',
            PITCH_TYPE_SELECTION_ENABLED:
              policies['PITCH_TYPE_SELECTION_ENABLED'] === undefined
                ? true
                : policies['PITCH_TYPE_SELECTION_ENABLED'] === 'true',
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
    // Fetch live machine list when the current center is resource-
    // based — the kit rental editor needs it to render per-machine
    // toggle + price rows. ABCA centers use the legacy enum allowlist
    // and don't need this fetch.
    if (currentCenter?.bookingModel === 'RESOURCE_BASED') {
      fetch(`/api/centers/${currentCenter.id}/machines`)
        .then((r) => (r.ok ? r.json() : []))
        .then((data) => {
          if (Array.isArray(data)) setCenterMachines(data);
        })
        .catch(() => setCenterMachines([]));
    } else {
      setCenterMachines([]);
    }
    // Re-fetch on center / scope change so values match the active
    // edit target (CenterPolicy(currentCenter) vs the global Policy).
  }, [currentCenter?.id, scope]);


  const handleSavePayment = async (key: string, value: boolean) => {
    setSavingPayment(true);
    setPaymentMessage({ text: '', type: '' });
    try {
      const res = await fetch(`/api/admin/policies?scope=${scope}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value: String(value) }),
      });
      if (!res.ok) {
        // Surface the server's error so a 403 (wrong center) or 400
        // (validation) is visible instead of silently swallowed.
        const errBody = await res.json().catch(() => ({} as { error?: string }));
        throw new Error(errBody?.error || `HTTP ${res.status}`);
      }

      // Re-fetch policies after save instead of trusting the optimistic
      // update. If the POST returned 200 but the upsert didn't actually
      // land (Prisma error swallowed, wrong center resolved, etc.) the
      // round-trip would catch it: the GET response would still show
      // the old value, and we'd update local state accordingly. This
      // is what stops the "I toggled it ON but refresh shows OFF"
      // class of bug — the GET-after-POST happens in the same tab so
      // a subsequent F5 will read the same value.
      const verifyRes = await fetch(`/api/admin/policies?scope=${scope}`);
      if (verifyRes.ok) {
        const data = await verifyRes.json();
        const arr: { key: string; value: string }[] =
          Array.isArray(data) ? data : (data.policies || []);
        const found = arr.find((p) => p.key === key);
        // Boolean policies arrive as 'true'/'false' strings. Coerce
        // back to boolean so the toggle reads it the same way the
        // GET handler in the page initial-load does.
        const persisted = found ? found.value === 'true' : value;
        setPaymentSettings(prev => ({ ...prev, [key]: persisted }));
        if (persisted !== value) {
          throw new Error(
            `Server kept it ${persisted ? 'ON' : 'OFF'} after the save — refresh and try again.`,
          );
        }
      } else {
        // Verify-fetch failed; trust the optimistic update for now.
        setPaymentSettings(prev => ({ ...prev, [key]: value }));
      }

      setPaymentMessage({ text: 'Saved', type: 'success' });
      setTimeout(() => setPaymentMessage({ text: '', type: '' }), 2500);
    } catch (err) {
      setPaymentMessage({
        text: err instanceof Error ? `Failed to save: ${err.message}` : 'Failed to save',
        type: 'error',
      });
    } finally {
      setSavingPayment(false);
    }
  };

  // Single global save for the whole Settings page. Persists everything
  // the page owns directly (machine config — pricing/timing/compat — and
  // kit rental), then bumps `settingsSaveTrigger` so the trigger-based
  // child editors (Booking Categories, Pitch Types, Resource Pricing)
  // save in lockstep. Those report their own status via onSaveStatus,
  // surfaced next to this button.
  const handleSaveMachine = async () => {
    setSavingMachine(true);
    setMachineMessage({ text: '', type: '' });
    const errors: string[] = [];
    try {
      // 1. Machine config (pricing, time slabs, machine-pitch config).
      const machineRes = await fetch(`/api/admin/machine-config?scope=${scope}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(machineConfig),
      });
      if (!machineRes.ok) {
        const data = await machineRes.json().catch(() => ({}));
        errors.push(data.error || 'Failed to save machine config');
      }

      // 2. Kit rental config (folded in from its old per-section button).
      const kitRes = await fetch(`/api/admin/policies?scope=${scope}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'KIT_RENTAL_CONFIG', value: JSON.stringify(kitRentalConfig) }),
      });
      if (!kitRes.ok) errors.push('Failed to save kit rental settings');

      // 3. Fire the trigger-based child editors (resource-based centers).
      setSettingsSaveTrigger(prev => prev + 1);

      if (errors.length > 0) {
        setMachineMessage({ text: errors.join('; '), type: 'error' });
      } else {
        setMachineMessage({ text: 'All settings saved successfully', type: 'success' });
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
        description={
          currentCenter
            ? `Payment, machines & pricing for ${currentCenter.name}`
            : 'Payment, machines & pricing'
        }
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
      >
        <div className="space-y-4">
          {/* Enable/Disable Toggle. Persisted by the single global Save
              button at the bottom of the page (no per-section save). */}
          <AdminToggle
            enabled={kitRentalConfig.enabled}
            onToggle={() => setKitRentalConfig(prev => ({ ...prev, enabled: !prev.enabled }))}
            label="Enable Kit Rental"
            description="Show kit rental option on booking page for selected machines"
            icon={ShoppingBag}
            disabled={savingMachine}
          />

          {kitRentalConfig.enabled && (
            <div className="space-y-3 pt-2">
              {/* For RESOURCE_BASED centers the standalone 'Rental
                  Price (per session)' field was removed — the price is
                  set per machine row below. The stored JSON's `price`
                  field stays as the default for any newly-added
                  machine.
                  For MACHINE_PITCH centers (ABCA), the legacy
                  multi-select machine list doesn't carry per-machine
                  prices, so the single price input still applies. */}
              {currentCenter?.bookingModel !== 'RESOURCE_BASED' && (
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
              )}

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

              {/* Per-center machine config. Two surfaces:
                  - ABCA (MACHINE_PITCH): the legacy multi-select of
                    the 4 enum machines (GRAVITY/YANTRA/LEVERAGE_*).
                    One global price field above governs all of them.
                  - Toplay (RESOURCE_BASED): one row per live Machine
                    at the center, each with its own enabled toggle
                    + price input. The global `price` field above
                    acts as the default for any newly-added machine. */}
              {currentCenter?.bookingModel === 'RESOURCE_BASED' ? (
                <div>
                  <label className="block text-[10px] font-medium text-slate-400 mb-2 uppercase tracking-wider">
                    Per-machine kit rental
                  </label>
                  {centerMachines.length === 0 ? (
                    <p className="text-[11px] text-slate-500 italic">
                      No machines configured at this center yet.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {centerMachines
                        .filter((m) => m.isActive)
                        .map((m) => {
                          const cfg = kitRentalConfig.machineRowConfigs?.[m.id];
                          const enabled = cfg?.enabled ?? false;
                          const price = cfg?.price ?? kitRentalConfig.price;
                          const label = m.shortName || m.name;
                          return (
                            <div
                              key={m.id}
                              className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]"
                            >
                              {/* Toggle */}
                              <button
                                type="button"
                                onClick={() => {
                                  setKitRentalConfig((prev) => ({
                                    ...prev,
                                    machineRowConfigs: {
                                      ...(prev.machineRowConfigs ?? {}),
                                      [m.id]: {
                                        enabled: !enabled,
                                        price: cfg?.price ?? prev.price,
                                      },
                                    },
                                  }));
                                }}
                                className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                                  enabled ? 'bg-accent border-accent' : 'border-slate-600'
                                }`}
                              >
                                {enabled && <Check className="w-2.5 h-2.5 text-primary" />}
                              </button>
                              {/* Machine name */}
                              <div className="flex-1 min-w-0">
                                <div className={`text-xs font-semibold truncate ${enabled ? 'text-white' : 'text-slate-400'}`}>
                                  {label}
                                </div>
                                <div className="text-[10px] text-slate-500">
                                  {m.machineType.name} · {m.machineType.ballType.toLowerCase()}
                                </div>
                              </div>
                              {/* Per-machine price */}
                              <div className="relative w-24">
                                <IndianRupee className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500" />
                                <input
                                  type="number"
                                  min="0"
                                  value={price}
                                  disabled={!enabled}
                                  onChange={(e) =>
                                    setKitRentalConfig((prev) => ({
                                      ...prev,
                                      machineRowConfigs: {
                                        ...(prev.machineRowConfigs ?? {}),
                                        [m.id]: {
                                          enabled: true,
                                          price: Math.max(0, Number(e.target.value)),
                                        },
                                      },
                                    }))
                                  }
                                  placeholder="0"
                                  className="w-full bg-white/[0.04] border border-white/[0.1] text-white rounded-md pl-6 pr-2 py-1.5 text-xs outline-none focus:border-accent disabled:opacity-50"
                                />
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  )}
                  <p className="mt-2 text-[10px] text-slate-500">
                    Toggle a machine to enable kit rental for that machine, and set its per-slot price.
                    The default price above is used for any newly-added machine until you override it.
                  </p>
                </div>
              ) : (
                <div>
                  <label className="block text-[10px] font-medium text-slate-400 mb-2 uppercase tracking-wider">Applicable Machines</label>
                  <div className="grid grid-cols-2 gap-2">
                    {ALL_MACHINE_IDS.map((mid) => {
                      const isSelected = kitRentalConfig.machines.includes(mid);
                      return (
                        <button
                          key={mid}
                          type="button"
                          onClick={() => {
                            setKitRentalConfig((prev) => ({
                              ...prev,
                              machines: isSelected
                                ? prev.machines.filter((m) => m !== mid)
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
              )}
            </div>
          )}
        </div>
      </AdminCard>

      {/* ─── Machine Configuration ──────────────────
          Hardcoded against the legacy MachineId enum (Gravity / Yantra /
          Leverage Indoor / Leverage Outdoor) — only meaningful for
          MACHINE_PITCH centers. Resource-based centers configure
          machines per-row under Center → Machines, so hide the ghost
          four-machine UI here. */}
      {currentCenter?.bookingModel !== 'RESOURCE_BASED' && (
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
          <div className="space-y-3">
            {/* Leather Ball Machine */}
            <div className="bg-white/[0.02] rounded-xl border border-white/[0.05] p-3">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2.5 flex items-center gap-2">
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
            <div className="bg-white/[0.02] rounded-xl border border-white/[0.05] p-3">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2.5 flex items-center gap-2">
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
            <div className="bg-white/[0.02] rounded-xl border border-white/[0.05] p-3">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-1">Machine — Pitch Compatibility</h3>
              <p className="text-[10px] text-slate-500 mb-2.5">Toggle which pitch types are available for each machine</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
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
            <div className="bg-white/[0.02] rounded-xl border border-white/[0.05] p-3">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2.5">Slot Timing Configuration</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div className="bg-white/[0.02] rounded-xl p-2.5 border border-white/[0.05]">
                  <p className="text-[11px] font-bold text-slate-300 mb-2 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                    Morning Hours
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
                <div className="bg-white/[0.02] rounded-xl p-2.5 border border-white/[0.05]">
                  <p className="text-[11px] font-bold text-slate-300 mb-2 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                    Evening Hours
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
            <div className="bg-white/[0.02] rounded-xl border border-white/[0.05] p-3">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2.5">Slot Pricing Configuration</h3>

              {/* Tab Selector */}
              <div className="flex gap-1 overflow-x-auto pb-2 mb-2.5 scrollbar-hide">
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
                  <div key={`${activePricingTab}-${pitch}`} className="bg-white/[0.02] rounded-xl p-2.5 border border-white/[0.05] mb-2">
                    <p className="text-[11px] font-bold text-slate-300 mb-1.5">
                      {pitch === 'ASTRO' ? 'Astro Turf' : pitch === 'CEMENT' ? 'Cement Wicket' : 'Natural Turf'}
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <PriceField
                        label="Morning Slot 1"
                        value={pitchPricing.morning.single}
                        onChange={v => updatePricing([activePricingTab, pitch, 'morning', 'single'], v)}
                      />
                      <PriceField
                        label="Morning Slot 2"
                        value={pitchPricing.morning.consecutive}
                        onChange={v => updatePricing([activePricingTab, pitch, 'morning', 'consecutive'], v)}
                      />
                      <PriceField
                        label="Evening Slot 1"
                        value={pitchPricing.evening.single}
                        onChange={v => updatePricing([activePricingTab, pitch, 'evening', 'single'], v)}
                      />
                      <PriceField
                        label="Evening Slot 2"
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
      )}

      {/* Resource-based "Machine Configuration" card. Mirrors the
          single ABCA card on main: same Zap icon, same title, same
          structure (Slot Timing → Slot Pricing). Per-Machine pitch
          and ball compatibility live under Center → Machines because
          it's per row, not per category. Booking categories stays as
          its own card below — it controls which CATEGORY tabs the
          user-facing slot picker exposes, which is a separate concern
          from pricing. */}
      {currentCenter?.bookingModel === 'RESOURCE_BASED' && !machineLoading && (
        <AdminCard
          title="Machine Configuration"
          icon={<Zap className="w-4 h-4 text-accent" />}
          collapsible
          defaultOpen={false}
        >
          <div className="space-y-3">
            {/* ─── Slot Timing Configuration ────────── */}
            <div className="bg-white/[0.02] rounded-xl border border-white/[0.05] p-3">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2.5">
                Slot Timing Configuration
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div className="bg-white/[0.02] rounded-xl p-2.5 border border-white/[0.05]">
                  <p className="text-[11px] font-bold text-slate-300 mb-2 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                    Morning Hours
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] font-medium text-slate-400 mb-1">Start</label>
                      <input
                        type="time"
                        value={machineConfig.timeSlabConfig.morning.start}
                        onChange={(e) => updateTimeSlab('morning', 'start', e.target.value)}
                        step="1800"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-medium text-slate-400 mb-1">End</label>
                      <input
                        type="time"
                        value={machineConfig.timeSlabConfig.morning.end}
                        onChange={(e) => updateTimeSlab('morning', 'end', e.target.value)}
                        step="1800"
                        className={inputClass}
                      />
                    </div>
                  </div>
                </div>
                <div className="bg-white/[0.02] rounded-xl p-2.5 border border-white/[0.05]">
                  <p className="text-[11px] font-bold text-slate-300 mb-2 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                    Evening Hours
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] font-medium text-slate-400 mb-1">Start</label>
                      <input
                        type="time"
                        value={machineConfig.timeSlabConfig.evening.start}
                        onChange={(e) => updateTimeSlab('evening', 'start', e.target.value)}
                        step="1800"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-medium text-slate-400 mb-1">End</label>
                      <input
                        type="time"
                        value={machineConfig.timeSlabConfig.evening.end}
                        onChange={(e) => updateTimeSlab('evening', 'end', e.target.value)}
                        step="1800"
                        className={inputClass}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ─── Slot Pricing Configuration ───────── */}
            <div className="bg-white/[0.02] rounded-xl border border-white/[0.05] p-3">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                Slot Pricing Configuration
              </h3>
              <p className="text-[11px] text-slate-500 leading-relaxed mb-2.5">
                Per-Machine pricing with single + consecutive rates per
                pitch and ball type. Per-machine pitch / ball
                compatibility live under{' '}
                <a
                  href={`/admin/centers/${currentCenter.id}`}
                  className="text-accent underline hover:text-accent/80"
                >
                  Center → Machines
                </a>
                .
              </p>
              <ResourcePricingEditor
                scope={scope}
                centerLabel={currentCenter.shortName ?? currentCenter.name}
                externalSaveTrigger={settingsSaveTrigger}
                onSaveStatus={setResourcePricingSaveStatus}
              />
            </div>
          </div>
        </AdminCard>
      )}

      {/* Unified Booking Settings — Booking Categories + Pitch Types per
          Category. No per-section Save button: everything on this page is
          persisted by the single global Save button at the bottom. */}
      {currentCenter?.bookingModel === 'RESOURCE_BASED' && (
        <AdminCard
          title="Booking Settings"
          icon={<Settings className="w-4 h-4 text-accent" />}
          collapsible
          defaultOpen={true}
        >
          <div className="space-y-5">
            {/* Booking categories */}
            <div>
              <div className="flex items-center gap-2 mb-2.5">
                <Ticket className="w-3.5 h-3.5 text-accent/70" />
                <h4 className="text-[11px] font-bold text-white uppercase tracking-wider">Booking Categories</h4>
              </div>
              <EnabledCategoriesEditor
                scope={scope}
                centerLabel={currentCenter.shortName ?? currentCenter.name}
                externalSaveTrigger={settingsSaveTrigger}
                onSaveStatus={setCategoriesSaveStatus}
              />
            </div>

            {/* Pitch types per category */}
            <div className="pt-4 border-t border-white/[0.06]">
              <div className="flex items-center gap-2 mb-2.5">
                <Zap className="w-3.5 h-3.5 text-accent/70" />
                <h4 className="text-[11px] font-bold text-white uppercase tracking-wider">Pitch Types Per Category</h4>
              </div>
              <EnabledPitchTypesEditor
                scope={scope}
                externalSaveTrigger={settingsSaveTrigger}
                onSaveStatus={setPitchTypesSaveStatus}
              />
            </div>
          </div>
        </AdminCard>
      )}

      {/* Match Practice — Corporate Batch (monthly / regular enrollment)
          + Match Simulation session CRUD. Both are seat-based booking
          flows surfaced under the user-side "Match Practice" category
          tab (enable/disable the tab itself under Booking Categories
          above). Saves with the single global Save button below. */}
      {currentCenter?.bookingModel === 'RESOURCE_BASED' && (
        <AdminCard
          title="Match Practice"
          icon={<Ticket className="w-4 h-4 text-accent" />}
          collapsible
          defaultOpen={false}
        >
          <MatchPracticeConfigEditor
            scope={scope}
            centerLabel={currentCenter.shortName ?? currentCenter.name}
            externalSaveTrigger={settingsSaveTrigger}
            onSaveStatus={setMatchPracticeSaveStatus}
          />
        </AdminCard>
      )}

      {/* Slot picker — user-facing toggles for ball / pitch selectors.
          On RESOURCE_BASED centers each Machine row already declares
          its supportedBallTypes / supportedPitchTypes (see Center →
          Machines). These two toggles act as a *center-wide* override
          on top of those: when OFF, ResourceSlotsPage hides the chip
          rows and auto-picks the first supported option per machine.
          ON is the default — chips show whenever the machine supports
          more than one value. Matches what ABCA exposes globally.

          NOTE: toggling here writes via /api/admin/policies (one POST
          per flip), NOT via 'Save Machine Configuration' at the bottom
          of the page. Each click is its own save — the Saved /
          Failed-to-save banner under the toggles confirms the result.
          Don't wire these into the machine-config save button: that
          one POSTs to a different endpoint and would silently drop
          these keys. */}
      {currentCenter?.bookingModel === 'RESOURCE_BASED' && (
        <AdminCard
          title="Slot picker display"
          icon={<Zap className="w-4 h-4 text-accent" />}
          collapsible
          defaultOpen={false}
        >
          <div className="space-y-1">
            <AdminToggle
              enabled={paymentSettings.BALL_TYPE_SELECTION_ENABLED}
              onToggle={() => handleSavePayment(
                'BALL_TYPE_SELECTION_ENABLED',
                !paymentSettings.BALL_TYPE_SELECTION_ENABLED,
              )}
              label="Ball type selection"
              description="Show the ball-type chip row when a machine supports more than one. Turn off to auto-pick the first supported ball."
              size="sm"
              disabled={savingPayment}
            />
            <AdminToggle
              enabled={paymentSettings.PITCH_TYPE_SELECTION_ENABLED}
              onToggle={() => handleSavePayment(
                'PITCH_TYPE_SELECTION_ENABLED',
                !paymentSettings.PITCH_TYPE_SELECTION_ENABLED,
              )}
              label="Pitch type selection"
              description="Show the pitch-type chip row for MACHINE / SIDEARM / NET when the relevant resource supports more than one. Turn off to auto-pick the first."
              size="sm"
              disabled={savingPayment}
            />
            <p className="text-[10px] text-slate-500 italic mt-2">
              Saves immediately on click. The &lsquo;Save Machine
              Configuration&rsquo; button at the bottom does NOT save
              these toggles &mdash; if you flipped one but didn&rsquo;t see
              a &lsquo;Saved&rsquo; / &lsquo;Failed to save&rsquo; line below it, the
              click never registered.
            </p>
            {paymentMessage.text && (
              <p className={`text-xs mt-1 font-medium ${paymentMessage.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
                {paymentMessage.text}
              </p>
            )}
          </div>
        </AdminCard>
      )}

      {/* Global Save Confirmation */}
      <ConfirmDialog
        open={showMachineConfigConfirm}
        title="Save Settings"
        message="Save all changes on this page (machine configuration, slot timing & pricing, booking settings)?"
        confirmLabel="Save"
        cancelLabel="Cancel"
        loading={savingMachine || isSettingsSaving}
        onConfirm={() => {
          setShowMachineConfigConfirm(false);
          handleSaveMachine();
        }}
        onCancel={() => setShowMachineConfigConfirm(false)}
      />


      {/* ─── Single global Save button (bottom of page) ───
          Saves everything on the page: machine configuration, slot
          timing, slot pricing, kit rental and (resource-based centers)
          booking categories + pitch types. All other per-section save
          buttons were removed in favour of this one. */}
      <div className="sticky bottom-4 z-40 flex items-center gap-3 p-4 rounded-2xl bg-[#0b1726]/95 backdrop-blur-xl border border-white/[0.08] shadow-xl shadow-black/30">
        <button
          onClick={() => setShowMachineConfigConfirm(true)}
          disabled={savingMachine || isSettingsSaving}
          className="inline-flex items-center gap-2 bg-accent hover:bg-accent-light text-primary px-6 py-3 rounded-xl text-sm font-semibold transition-all cursor-pointer disabled:opacity-50 shadow-sm shadow-accent/20 hover:shadow-accent/30"
        >
          {(savingMachine || isSettingsSaving) ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save All Settings
        </button>
        {settingsError ? (
          <span className="text-sm font-medium text-red-400">{settingsError.text}</span>
        ) : machineMessage.text ? (
          <span className={`text-sm font-medium ${machineMessage.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
            {machineMessage.text}
          </span>
        ) : null}
      </div>
    </div>
  );
}
