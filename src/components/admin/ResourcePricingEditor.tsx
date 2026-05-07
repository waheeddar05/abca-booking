'use client';

import { useEffect, useState } from 'react';
import { IndianRupee, Loader2, Save, Trash2 } from 'lucide-react';
import { useCenter } from '@/lib/center-context';

/**
 * Edits the `RESOURCE_PRICING_CONFIG` policy for a resource-based
 * center (Toplay et al). Replaces the ABCA-style per-machine/per-pitch
 * pricing matrix, which doesn't fit the resource-based model.
 *
 * Shape of the policy value:
 *
 *   {
 *     categoryRates: {
 *       MACHINE:        { morning, evening },
 *       SIDEARM:        { morning, evening },
 *       COACHING:       { morning, evening },
 *       FULL_COURT:     { morning, evening },
 *       CORPORATE_BATCH:{ morning, evening },
 *       NET:            { morning, evening },
 *     },
 *     machineTypeOverrides?: { [machineTypeCode]: { morning, evening } }
 *   }
 *
 * Reads via GET /api/admin/policies?scope=… and writes via POST. Uses
 * the same scope toggle the Settings page passes — so this editor
 * works for both center overrides and the global default fallback.
 */

type SlabRates = { morning: number; evening: number };
type CategoryKey = 'MACHINE' | 'SIDEARM' | 'COACHING' | 'FULL_COURT' | 'CORPORATE_BATCH' | 'NET';
type PitchKey = 'ASTRO' | 'CEMENT' | 'NATURAL';
type BallKey = 'LEATHER' | 'TENNIS' | 'MACHINE' | '*';

const PITCH_KEYS: PitchKey[] = ['ASTRO', 'CEMENT', 'NATURAL'];
const PITCH_LABELS: Record<PitchKey, string> = {
  ASTRO: 'Astro Turf',
  CEMENT: 'Cement',
  NATURAL: 'Natural Turf',
};
const BALL_KEYS: BallKey[] = ['*', 'LEATHER', 'TENNIS', 'MACHINE'];
const BALL_LABELS: Record<BallKey, string> = {
  '*': 'Any ball',
  LEATHER: 'Leather',
  TENNIS: 'Tennis',
  MACHINE: 'Machine',
};

/** Pair-shaped rate for the per-Machine-row matrix — mirrors the
 *  ABCA pricing config's `{ single, consecutive }` pair so admins can
 *  set a discounted back-to-back price. */
type SlabRatePair = { single: number; consecutive: number };
type PairSlabRates = { morning: SlabRatePair; evening: SlabRatePair };

interface ResourcePricingValue {
  categoryRates: Record<CategoryKey, SlabRates>;
  /** Coarse legacy override per machine type — used as fallback when
   *  `machinePricing` doesn't have an entry for a (pitch, ball) combo. */
  machineTypeOverrides?: Record<string, SlabRates>;
  /** machinePricing[code][pitch][ball] → rates. `'*'` for "any ball". */
  machinePricing?: Record<string, Partial<Record<PitchKey, Partial<Record<BallKey, SlabRates>>>>>;
  /** machineRowPricing[machineId][pitch][ball] → pair rates. The most-
   *  specific override axis: lets a center with two Yantra machines
   *  price each one separately. Pair-shaped so ABCA's
   *  single/consecutive convention works here too. */
  machineRowPricing?: Record<string, Partial<Record<PitchKey, Partial<Record<BallKey, PairSlabRates>>>>>;
  /** sidearmPricing[pitch] → rates. */
  sidearmPricing?: Partial<Record<PitchKey, SlabRates>>;
  /** netPricing[pitch] → rates. */
  netPricing?: Partial<Record<PitchKey, SlabRates>>;
}

interface CenterMachineLite {
  id: string;
  name: string;
  shortName?: string | null;
  isActive: boolean;
  machineType: { code: string; name: string };
}

const CATEGORY_LABELS: Record<CategoryKey, string> = {
  MACHINE: 'Bowling Machine',
  SIDEARM: 'Sidearm',
  COACHING: 'Personal Coaching',
  FULL_COURT: 'Full Indoor Court',
  CORPORATE_BATCH: 'Corporate Batch',
  NET: 'Net Only',
};

const CATEGORY_ORDER: CategoryKey[] = [
  'MACHINE',
  'SIDEARM',
  'COACHING',
  'NET',
  'FULL_COURT',
  'CORPORATE_BATCH',
];

const DEFAULT_VALUE: ResourcePricingValue = {
  categoryRates: {
    MACHINE:        { morning: 600, evening: 800 },
    SIDEARM:        { morning: 700, evening: 900 },
    COACHING:       { morning: 1000, evening: 1200 },
    FULL_COURT:     { morning: 2400, evening: 3200 },
    CORPORATE_BATCH:{ morning: 1500, evening: 1800 },
    NET:            { morning: 400, evening: 500 },
  },
  machineTypeOverrides: {},
};

function safeRate(v: SlabRates | undefined | null): SlabRates {
  return {
    morning: typeof v?.morning === 'number' ? v.morning : 0,
    evening: typeof v?.evening === 'number' ? v.evening : 0,
  };
}

function normalize(raw: Partial<ResourcePricingValue> | null | undefined): ResourcePricingValue {
  const base = raw?.categoryRates ?? {};
  const filled: Record<CategoryKey, SlabRates> = {
    MACHINE:         safeRate((base as Record<string, SlabRates>).MACHINE         ?? DEFAULT_VALUE.categoryRates.MACHINE),
    SIDEARM:         safeRate((base as Record<string, SlabRates>).SIDEARM         ?? DEFAULT_VALUE.categoryRates.SIDEARM),
    COACHING:        safeRate((base as Record<string, SlabRates>).COACHING        ?? DEFAULT_VALUE.categoryRates.COACHING),
    FULL_COURT:      safeRate((base as Record<string, SlabRates>).FULL_COURT      ?? DEFAULT_VALUE.categoryRates.FULL_COURT),
    CORPORATE_BATCH: safeRate((base as Record<string, SlabRates>).CORPORATE_BATCH ?? DEFAULT_VALUE.categoryRates.CORPORATE_BATCH),
    NET:             safeRate((base as Record<string, SlabRates>).NET             ?? DEFAULT_VALUE.categoryRates.NET),
  };
  const overrides: Record<string, SlabRates> = {};
  for (const [code, rates] of Object.entries(raw?.machineTypeOverrides ?? {})) {
    overrides[code] = safeRate(rates);
  }
  return {
    categoryRates: filled,
    machineTypeOverrides: overrides,
    machinePricing: (raw?.machinePricing ?? {}) as ResourcePricingValue['machinePricing'],
    machineRowPricing: (raw?.machineRowPricing ?? {}) as ResourcePricingValue['machineRowPricing'],
    sidearmPricing: (raw?.sidearmPricing ?? {}) as ResourcePricingValue['sidearmPricing'],
    netPricing: (raw?.netPricing ?? {}) as ResourcePricingValue['netPricing'],
  };
}

export function ResourcePricingEditor({
  scope,
  centerLabel,
}: {
  /** 'center' writes to CenterPolicy(currentCenter); 'global' writes to Policy. */
  scope: 'center' | 'global';
  /** Display name used in the "Saved for X" toast. */
  centerLabel: string;
}) {
  const [value, setValue] = useState<ResourcePricingValue>(DEFAULT_VALUE);
  const [centerMachines, setCenterMachines] = useState<CenterMachineLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const { currentCenter } = useCenter();

  // Fetch the center's specific Machine rows — the "two Yantras at
  // Toplay" use case. Empty for global scope or before the center
  // context resolves.
  useEffect(() => {
    if (scope !== 'center' || !currentCenter) {
      setCenterMachines([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/centers/${currentCenter.id}/machines`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: CenterMachineLite[]) => {
        if (cancelled) return;
        setCenterMachines(Array.isArray(rows) ? rows.filter((m) => m.isActive) : []);
      })
      .catch(() => setCenterMachines([]));
    return () => {
      cancelled = true;
    };
  }, [scope, currentCenter?.id]);

  // Fetch the resolved RESOURCE_PRICING_CONFIG for the active scope.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const policyRes = await fetch(`/api/admin/policies?scope=${scope}`);
        if (cancelled) return;
        if (policyRes.ok) {
          const rows: Array<{ key: string; value: string }> = await policyRes.json();
          const row = rows.find((r) => r.key === 'RESOURCE_PRICING_CONFIG');
          if (row) {
            try { setValue(normalize(JSON.parse(row.value))); }
            catch { setValue(DEFAULT_VALUE); }
          } else {
            setValue(DEFAULT_VALUE);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [scope]);

  const setRate = (cat: CategoryKey, slab: 'morning' | 'evening', n: number) => {
    setValue((prev) => ({
      ...prev,
      categoryRates: {
        ...prev.categoryRates,
        [cat]: { ...prev.categoryRates[cat], [slab]: n },
      },
    }));
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/policies?scope=${scope}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: 'RESOURCE_PRICING_CONFIG',
          value: JSON.stringify(value),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setMessage({ text: body?.error || 'Save failed', ok: false });
        return;
      }
      setMessage({ text: `Saved for ${centerLabel}`, ok: true });
      setTimeout(() => setMessage(null), 3500);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-slate-400 py-6 justify-center text-sm">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading pricing…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ─── Bowling Machine pricing — tabbed per Machine row ─────────
          Mirrors main's ABCA pricing editor (5 tabs: leather / yantra /
          machine / yantra_machine / tennis), but at this center-scope
          each tab is a specific Machine ROW. Two Yantras at Toplay get
          two tabs and can be priced independently. Each tab holds a
          3-pitch × 4-ball matrix with morning + evening, single +
          consecutive — same shape as PRICING_CONFIG on main. */}
      {scope === 'center' && centerMachines.length > 0 ? (
        <TabbedMachinePricing
          machines={centerMachines}
          matrix={value.machineRowPricing ?? {}}
          onChange={(machineId, pitch, ball, slab, kind, n) => {
            setValue((prev) => {
              const all = { ...(prev.machineRowPricing ?? {}) };
              const byMachine = { ...(all[machineId] ?? {}) };
              const byPitch = { ...(byMachine[pitch] ?? {}) };
              const cell: PairSlabRates = byPitch[ball]
                ? {
                    morning: { ...byPitch[ball]!.morning },
                    evening: { ...byPitch[ball]!.evening },
                  }
                : {
                    morning: { single: 0, consecutive: 0 },
                    evening: { single: 0, consecutive: 0 },
                  };
              cell[slab] = { ...cell[slab], [kind]: n };
              byPitch[ball] = cell;
              byMachine[pitch] = byPitch;
              all[machineId] = byMachine;
              return { ...prev, machineRowPricing: all };
            });
          }}
          onClearCell={(machineId, pitch, ball) => {
            setValue((prev) => {
              const all = { ...(prev.machineRowPricing ?? {}) };
              const byMachine = { ...(all[machineId] ?? {}) };
              const byPitch = { ...(byMachine[pitch] ?? {}) };
              delete byPitch[ball];
              if (Object.keys(byPitch).length === 0) delete byMachine[pitch];
              else byMachine[pitch] = byPitch;
              if (Object.keys(byMachine).length === 0) delete all[machineId];
              else all[machineId] = byMachine;
              return { ...prev, machineRowPricing: all };
            });
          }}
        />
      ) : (
        <div className="text-[11px] text-slate-500 italic py-2">
          {scope === 'global'
            ? 'Bowling Machine pricing is configured per machine row at each center (Settings → Resource pricing on the center page).'
            : 'No machines configured at this center yet. Add a machine on the Centers → Machines tab to enable per-machine pricing.'}
        </div>
      )}

      {/* Sidearm per-pitch overrides — only relevant for centers that
          run sidearm sessions. Empty cells fall back to the SIDEARM
          category default. */}
      <SimplePitchSection
        title="Sidearm — per pitch"
        rates={value.sidearmPricing ?? {}}
        onChange={(pitch, slab, n) => {
          setValue((prev) => {
            const next = { ...(prev.sidearmPricing ?? {}) };
            next[pitch] = { ...(next[pitch] ?? { morning: 0, evening: 0 }), [slab]: n };
            return { ...prev, sidearmPricing: next };
          });
        }}
        onClear={(pitch) => {
          setValue((prev) => {
            const next = { ...(prev.sidearmPricing ?? {}) };
            delete next[pitch];
            return { ...prev, sidearmPricing: next };
          });
        }}
      />

      {/* Net per-pitch overrides — bare-net booking pricing. */}
      <SimplePitchSection
        title="Cricket nets booking — per pitch"
        rates={value.netPricing ?? {}}
        onChange={(pitch, slab, n) => {
          setValue((prev) => {
            const next = { ...(prev.netPricing ?? {}) };
            next[pitch] = { ...(next[pitch] ?? { morning: 0, evening: 0 }), [slab]: n };
            return { ...prev, netPricing: next };
          });
        }}
        onClear={(pitch) => {
          setValue((prev) => {
            const next = { ...(prev.netPricing ?? {}) };
            delete next[pitch];
            return { ...prev, netPricing: next };
          });
        }}
      />

      {/* Other categories — Personal Coaching, Full Indoor Court,
          Corporate Batch. These don't vary by machine or pitch the way
          MACHINE/SIDEARM/NET do, so a single morning/evening price
          per category is enough. Replaces the old per-category rates
          table (which exposed every category at once) with just the
          three that aren't already configured above. */}
      <div className="space-y-2 pt-3 border-t border-white/[0.04]">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
          Other categories
        </div>
        <div className="grid grid-cols-[1fr_auto_auto] gap-2 sm:gap-3 items-center text-[10px] uppercase tracking-wider text-slate-500">
          <div>Category</div>
          <div className="w-20 sm:w-28 text-center">Morning</div>
          <div className="w-20 sm:w-28 text-center">Evening</div>
        </div>
        {(['COACHING', 'FULL_COURT', 'CORPORATE_BATCH'] as const).map((cat) => (
          <div key={cat} className="grid grid-cols-[1fr_auto_auto] gap-2 sm:gap-3 items-center">
            <div className="text-xs sm:text-sm text-white truncate">{CATEGORY_LABELS[cat]}</div>
            <PriceInput
              value={value.categoryRates[cat].morning}
              onChange={(n) => setRate(cat, 'morning', n)}
            />
            <PriceInput
              value={value.categoryRates[cat].evening}
              onChange={(n) => setRate(cat, 'evening', n)}
            />
          </div>
        ))}
      </div>

      {/* Save bar */}
      <div className="flex items-center justify-end gap-2 pt-2">
        {message && (
          <span className={`text-xs font-medium ${message.ok ? 'text-green-400' : 'text-red-400'}`}>
            {message.text}
          </span>
        )}
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-black text-xs font-semibold hover:bg-accent/90 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer transition-all"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Save
        </button>
      </div>
    </div>
  );
}

function PriceInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  // Mostly-controlled: value is the canonical source; we only keep a
  // small local string when the user is actively typing so they can
  // clear the field momentarily. No effect-driven setState — the input
  // re-derives from `value` once it's blurred.
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className="relative w-20 sm:w-28">
      <IndianRupee className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500" />
      <input
        type="number"
        inputMode="decimal"
        value={draft ?? String(value)}
        onFocus={() => setDraft(String(value))}
        onBlur={() => setDraft(null)}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value !== '' && !Number.isNaN(n)) onChange(n);
        }}
        className="w-full bg-white/[0.04] border border-white/[0.1] text-white placeholder:text-slate-500 rounded-lg pl-7 pr-2 py-1.5 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition-colors"
      />
    </div>
  );
}

/**
 * Tabbed pricing editor — one tab per Machine row at the active
 * center. Mirrors main's `Slot Pricing Configuration` (which has
 * tabs for leather / yantra / machine / yantra_machine / tennis).
 * The active tab shows a 3-pitch × 4-ball matrix where each cell
 * has morning + evening, single + consecutive — same shape as
 * PRICING_CONFIG on main, just keyed by Machine.id.
 */
function TabbedMachinePricing({
  machines,
  matrix,
  onChange,
  onClearCell,
}: {
  machines: CenterMachineLite[];
  matrix: NonNullable<ResourcePricingValue['machineRowPricing']>;
  onChange: (
    machineId: string,
    pitch: PitchKey,
    ball: BallKey,
    slab: 'morning' | 'evening',
    kind: 'single' | 'consecutive',
    n: number,
  ) => void;
  onClearCell: (machineId: string, pitch: PitchKey, ball: BallKey) => void;
}) {
  const [activeId, setActiveId] = useState<string>(machines[0]?.id ?? '');
  // Keep the active tab valid when the machines list changes (e.g. an
  // admin disables a machine while this editor is open).
  useEffect(() => {
    if (!machines.find((m) => m.id === activeId)) {
      setActiveId(machines[0]?.id ?? '');
    }
  }, [machines, activeId]);

  const active = machines.find((m) => m.id === activeId) ?? machines[0];
  const cellsConfigured = (machineId: string): number => {
    const byMachine = matrix[machineId] ?? {};
    return Object.values(byMachine).reduce(
      (s, byPitch) => s + Object.keys(byPitch ?? {}).length,
      0,
    );
  };

  return (
    <div className="space-y-3">
      {/* Tab strip — horizontally scrollable on phones. */}
      <div className="flex gap-1 overflow-x-auto pb-2 scrollbar-hide">
        {machines.map((m) => {
          const isActive = activeId === m.id;
          const count = cellsConfigured(m.id);
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => setActiveId(m.id)}
              className={`flex-shrink-0 px-3 py-2 rounded-lg text-[11px] font-semibold transition-all cursor-pointer whitespace-nowrap ${
                isActive
                  ? 'bg-accent/15 text-accent border border-accent/30'
                  : 'bg-white/[0.03] text-slate-400 border border-white/[0.06] hover:text-slate-200'
              }`}
            >
              {m.shortName ?? m.name}
              {count > 0 && (
                <span className={`ml-1.5 text-[9px] px-1 rounded ${isActive ? 'bg-accent/20' : 'bg-white/[0.06]'}`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {active && (
        <div className="bg-white/[0.02] rounded-xl border border-white/[0.05] p-3 space-y-3">
          <div className="text-[11px] text-slate-500">
            Pitch × ball pricing for{' '}
            <span className="text-slate-300 font-semibold">
              {active.shortName ?? active.name}
            </span>
            . Each cell stores a morning and evening rate; each rate has a{' '}
            <span className="text-slate-300">single</span> price and a{' '}
            <span className="text-slate-300">consecutive</span> price (used when
            this slot is part of a back-to-back chain). Empty cells fall back
            to the category default.
          </div>
          {PITCH_KEYS.map((pitch) => (
            <div key={pitch} className="space-y-1">
              <div className="text-[11px] font-semibold text-slate-300">
                {PITCH_LABELS[pitch]}
              </div>
              <div className="grid grid-cols-[6.5rem_1fr_1fr_auto] gap-2 items-end pb-1 border-b border-white/[0.04] text-[9px] uppercase tracking-wider text-slate-500">
                <div>Ball</div>
                <div className="text-center">
                  Morning
                  <div className="text-[8px] text-slate-600 normal-case font-medium">
                    single / consecutive
                  </div>
                </div>
                <div className="text-center">
                  Evening
                  <div className="text-[8px] text-slate-600 normal-case font-medium">
                    single / consecutive
                  </div>
                </div>
                <div className="w-7" />
              </div>
              {BALL_KEYS.map((ball) => {
                const cell = matrix[active.id]?.[pitch]?.[ball];
                const has = cell != null;
                return (
                  <div
                    key={ball}
                    className="grid grid-cols-[6.5rem_1fr_1fr_auto] gap-2 items-center"
                  >
                    <div className="text-xs text-slate-300 truncate">
                      {BALL_LABELS[ball]}
                    </div>
                    <PairPriceCell
                      pair={cell?.morning ?? { single: 0, consecutive: 0 }}
                      onChange={(kind, n) => onChange(active.id, pitch, ball, 'morning', kind, n)}
                    />
                    <PairPriceCell
                      pair={cell?.evening ?? { single: 0, consecutive: 0 }}
                      onChange={(kind, n) => onChange(active.id, pitch, ball, 'evening', kind, n)}
                    />
                    <button
                      type="button"
                      onClick={() => onClearCell(active.id, pitch, ball)}
                      disabled={!has}
                      className="p-1.5 rounded-lg text-red-400/70 hover:bg-red-500/10 hover:text-red-400 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Clear (fall back to category default)"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Compact pitch × slab editor used by SIDEARM and NET (which don't
 * vary by ball type). Three pitch rows × morning/evening + clear.
 */
function SimplePitchSection({
  title,
  rates,
  onChange,
  onClear,
}: {
  title: string;
  rates: Partial<Record<PitchKey, SlabRates>>;
  onChange: (pitch: PitchKey, slab: 'morning' | 'evening', n: number) => void;
  onClear: (pitch: PitchKey) => void;
}) {
  return (
    <div className="space-y-2 pt-3 border-t border-white/[0.04]">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
        {title}
      </div>
      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-center text-[10px] uppercase tracking-wider text-slate-500">
        <div>Pitch</div>
        <div className="w-20 sm:w-28 text-center">Morning</div>
        <div className="w-20 sm:w-28 text-center">Evening</div>
        <div className="w-7" />
      </div>
      {PITCH_KEYS.map((pitch) => {
        const cell = rates[pitch];
        const has = cell != null;
        return (
          <div key={pitch} className="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-center">
            <div className="text-xs sm:text-sm text-white truncate">{PITCH_LABELS[pitch]}</div>
            <PriceInput
              value={cell?.morning ?? 0}
              onChange={(n) => onChange(pitch, 'morning', n)}
            />
            <PriceInput
              value={cell?.evening ?? 0}
              onChange={(n) => onChange(pitch, 'evening', n)}
            />
            <button
              type="button"
              onClick={() => onClear(pitch)}
              disabled={!has}
              className="p-1.5 rounded-lg text-red-400/70 hover:bg-red-500/10 hover:text-red-400 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              title="Clear (fall back to category default)"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Side-by-side single / consecutive number inputs for one slab cell.
 * Compact so two of them fit in the per-machine matrix grid.
 */
function PairPriceCell({
  pair,
  onChange,
}: {
  pair: SlabRatePair;
  onChange: (kind: 'single' | 'consecutive', n: number) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-1">
      <PriceInput value={pair.single} onChange={(n) => onChange('single', n)} />
      <PriceInput value={pair.consecutive} onChange={(n) => onChange('consecutive', n)} />
    </div>
  );
}
