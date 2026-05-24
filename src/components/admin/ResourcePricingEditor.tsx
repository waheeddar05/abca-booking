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
/** Ball types stored in policy JSON. '*' is the legacy "any ball"
 *  catchall — kept in the data shape for back-compat but never shown
 *  in the editor; admins now pick a specific ball that the machine
 *  actually supports. */
type BallKey = 'LEATHER' | 'TENNIS' | 'MACHINE' | '*';
type SpecificBall = Exclude<BallKey, '*'>;

const PITCH_KEYS: PitchKey[] = ['ASTRO', 'CEMENT', 'NATURAL'];
const PITCH_LABELS: Record<PitchKey, string> = {
  ASTRO: 'Astro Turf',
  CEMENT: 'Cement Wicket',
  NATURAL: 'Natural Turf',
};
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
  /**
   * Category-level defaults. MACHINE/SIDEARM/NET/CORPORATE_BATCH keep
   * the legacy flat {morning, evening} shape because admins configure
   * those via more-specific per-pitch / per-machine matrices below.
   * COACHING + FULL_COURT use pair-shaped {single, consecutive} so the
   * 'Other categories' editor can offer 4 cells per category (matches
   * the cricket-net / sidearm UX requested by admins).
   */
  categoryRates: Record<CategoryKey, SlabRates>;
  /** Pair-shaped overrides for the per-category 4-cell editor. When
   *  present these win over `categoryRates` for that category. Engine's
   *  `pickRate` already accepts both flat numbers and pair shapes, so
   *  storing them as PairSlabRates is purely a UI / data convenience —
   *  no engine change needed on top of the per-category fallback. */
  coachingRate?: PairSlabRates;
  fullCourtRate?: PairSlabRates;
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
  /** sidearmPricing[pitch] → pair rates. Pair-shaped so admins can set
   *  a separate per-slot vs consecutive price for both morning and
   *  evening — same shape ABCA uses for bowling-machine pricing. The
   *  engine accepts either flat numbers (legacy) or pairs (current). */
  sidearmPricing?: Partial<Record<PitchKey, PairSlabRates>>;
  /** netPricing[pitch] → pair rates. Same single/consecutive shape as
   *  sidearmPricing — bare-net bookings can also be priced with a
   *  back-to-back discount. */
  netPricing?: Partial<Record<PitchKey, PairSlabRates>>;
  /** coachingPricing[pitch] → pair rates. Per-pitch override for
   *  Personal Coaching bookings, mirroring sidearm + net. Empty rows
   *  fall through to `coachingRate` (category-level pair). The
   *  engine consults this when category=COACHING and the booking
   *  carries a pitchType. */
  coachingPricing?: Partial<Record<PitchKey, PairSlabRates>>;
}

interface CenterMachineLite {
  id: string;
  name: string;
  shortName?: string | null;
  isActive: boolean;
  /** Server-resolved list of ball types this machine actually supports.
   *  Drives which (Machine × Ball) tabs render. Empty list (legacy
   *  data) falls back to the machineType.ballType single value. */
  effectiveBallTypes?: SpecificBall[];
  supportedBallTypes?: SpecificBall[];
  machineType: { code: string; name: string; ballType?: string };
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 bg-white/[0.02] border border-white/[0.06] rounded-xl p-4">
      <div className="text-xs uppercase tracking-wider font-bold text-slate-300 border-b border-white/[0.04] pb-2 mb-2">
        {title}
      </div>
      {children}
    </div>
  );
}

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

/**
 * Coerce a slab cell into pair shape `{ single, consecutive }`.
 * Existing policy data was written as flat numbers (legacy editor
 * shape); on load we lift those to `{ single: <number>, consecutive: 0 }`
 * so the new 4-cell UI can render them. The engine already accepts
 * both shapes via `pickRate`, so writing the pair shape back doesn't
 * break anything reading the same JSON.
 */
function toPair(v: unknown): { single: number; consecutive: number } {
  if (typeof v === 'number') return { single: v, consecutive: 0 };
  if (v && typeof v === 'object') {
    const obj = v as { single?: unknown; consecutive?: unknown };
    return {
      single: typeof obj.single === 'number' ? obj.single : 0,
      consecutive: typeof obj.consecutive === 'number' ? obj.consecutive : 0,
    };
  }
  return { single: 0, consecutive: 0 };
}

function safePairRates(v: unknown): PairSlabRates {
  const obj = (v ?? {}) as { morning?: unknown; evening?: unknown };
  return {
    morning: toPair(obj.morning),
    evening: toPair(obj.evening),
  };
}

/** Normalise a per-pitch map of rates into pair-shaped form. Drops
 *  unknown pitch keys; leaves missing keys absent (fall-through to
 *  category default). */
function normalisePerPitch(
  raw: unknown,
): Partial<Record<PitchKey, PairSlabRates>> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Partial<Record<PitchKey, PairSlabRates>> = {};
  for (const key of PITCH_KEYS) {
    const cell = (raw as Record<string, unknown>)[key];
    if (cell == null) continue;
    out[key] = safePairRates(cell);
  }
  return out;
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
    // Per-category pair-shaped overrides. Coalesce from either the
    // dedicated pair fields (coachingRate / fullCourtRate) or lift
    // the legacy flat categoryRates entry so existing centers don't
    // see the editor reset to 0 on first load.
    coachingRate: safePairRates(
      raw?.coachingRate
      ?? (raw?.categoryRates as Record<string, unknown> | undefined)?.COACHING,
    ),
    fullCourtRate: safePairRates(
      raw?.fullCourtRate
      ?? (raw?.categoryRates as Record<string, unknown> | undefined)?.FULL_COURT,
    ),
    machineTypeOverrides: overrides,
    machinePricing: (raw?.machinePricing ?? {}) as ResourcePricingValue['machinePricing'],
    machineRowPricing: (raw?.machineRowPricing ?? {}) as ResourcePricingValue['machineRowPricing'],
    sidearmPricing: normalisePerPitch(raw?.sidearmPricing),
    netPricing: normalisePerPitch(raw?.netPricing),
    coachingPricing: normalisePerPitch(raw?.coachingPricing),
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
    <div className="space-y-6">
      <Section title="Bowling Machine — per machine">
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
      </Section>

      <Section title="Sidearm — per pitch">
        <SimplePitchSection
          title="Sidearm Rates"
          rates={(value.sidearmPricing ?? {}) as Partial<Record<PitchKey, PairSlabRates>>}
          onChange={(pitch, slab, kind, n) => {
            setValue((prev) => {
              const next = { ...(prev.sidearmPricing ?? {}) } as Partial<Record<PitchKey, PairSlabRates>>;
              const prevCell = next[pitch] ?? {
                morning: { single: 0, consecutive: 0 },
                evening: { single: 0, consecutive: 0 },
              };
              next[pitch] = {
                ...prevCell,
                [slab]: { ...prevCell[slab], [kind]: n },
              };
              return { ...prev, sidearmPricing: next };
            });
          }}
          onClear={(pitch) => {
            setValue((prev) => {
              const next = { ...(prev.sidearmPricing ?? {}) } as Partial<Record<PitchKey, PairSlabRates>>;
              delete next[pitch];
              return { ...prev, sidearmPricing: next };
            });
          }}
        />
      </Section>

      <Section title="Cricket nets booking — per pitch">
        <SimplePitchSection
          title="Net Rates"
          rates={(value.netPricing ?? {}) as Partial<Record<PitchKey, PairSlabRates>>}
          onChange={(pitch, slab, kind, n) => {
            setValue((prev) => {
              const next = { ...(prev.netPricing ?? {}) } as Partial<Record<PitchKey, PairSlabRates>>;
              const prevCell = next[pitch] ?? {
                morning: { single: 0, consecutive: 0 },
                evening: { single: 0, consecutive: 0 },
              };
              next[pitch] = {
                ...prevCell,
                [slab]: { ...prevCell[slab], [kind]: n },
              };
              return { ...prev, netPricing: next };
            });
          }}
          onClear={(pitch) => {
            setValue((prev) => {
              const next = { ...(prev.netPricing ?? {}) } as Partial<Record<PitchKey, PairSlabRates>>;
              delete next[pitch];
              return { ...prev, netPricing: next };
            });
          }}
        />
      </Section>

      <Section title="Personal Coaching — per pitch">
        <SimplePitchSection
          title="Coaching Rates"
          rates={(value.coachingPricing ?? {}) as Partial<Record<PitchKey, PairSlabRates>>}
          onChange={(pitch, slab, kind, n) => {
            setValue((prev) => {
              const next = { ...(prev.coachingPricing ?? {}) } as Partial<Record<PitchKey, PairSlabRates>>;
              const prevCell = next[pitch] ?? {
                morning: { single: 0, consecutive: 0 },
                evening: { single: 0, consecutive: 0 },
              };
              next[pitch] = {
                ...prevCell,
                [slab]: { ...prevCell[slab], [kind]: n },
              };
              return { ...prev, coachingPricing: next };
            });
          }}
          onClear={(pitch) => {
            setValue((prev) => {
              const next = { ...(prev.coachingPricing ?? {}) } as Partial<Record<PitchKey, PairSlabRates>>;
              delete next[pitch];
              return { ...prev, coachingPricing: next };
            });
          }}
        />
      </Section>

      <Section title="Full Indoor Court Booking">
        <p className="text-[10px] text-slate-500 leading-relaxed mb-3">
          Platform-wide flat rate for the Full Indoor Court category.
          2 Cons. is the TOTAL for a back-to-back pair.
        </p>
        <div className="grid grid-cols-4 gap-2 mb-1">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 text-center">M. Single</div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500 text-center">M. 2 Cons.</div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500 text-center">E. Single</div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500 text-center">E. 2 Cons.</div>
        </div>
        {(() => {
          const cell = value.fullCourtRate!;
          const update = (slab: 'morning' | 'evening', kind: 'single' | 'consecutive', n: number) => {
            setValue((prev) => ({
              ...prev,
              fullCourtRate: { ...cell, [slab]: { ...cell[slab], [kind]: n } },
            }));
          };
          return (
            <div className="grid grid-cols-4 gap-2 py-0.5">
              <PriceInput value={cell.morning.single}      onChange={(n) => update('morning', 'single', n)} />
              <PriceInput value={cell.morning.consecutive} onChange={(n) => update('morning', 'consecutive', n)} />
              <PriceInput value={cell.evening.single}      onChange={(n) => update('evening', 'single', n)} />
              <PriceInput value={cell.evening.consecutive} onChange={(n) => update('evening', 'consecutive', n)} />
            </div>
          );
        })()}
      </Section>

      <Section title="Corporate Batch">
        <p className="text-[10px] text-slate-500 leading-relaxed mb-3">
          Morning and Evening flat rates for Corporate Batch bookings.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <LabeledPriceInput
            label="Morning Rate"
            value={value.categoryRates.CORPORATE_BATCH.morning}
            onChange={(n) => setRate('CORPORATE_BATCH', 'morning', n)}
          />
          <LabeledPriceInput
            label="Evening Rate"
            value={value.categoryRates.CORPORATE_BATCH.evening}
            onChange={(n) => setRate('CORPORATE_BATCH', 'evening', n)}
          />
        </div>
      </Section>

      {/* Save bar */}
      <div className="sticky bottom-0 bg-[#0f1d2f]/95 backdrop-blur-sm border-t border-white/[0.08] -mx-6 px-6 py-4 flex items-center justify-end gap-3 z-10">
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
    <div className="relative">
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
        className="w-full bg-white/[0.04] border border-white/[0.1] text-white placeholder:text-slate-500 rounded-lg pl-7 pr-2 py-1.5 text-xs sm:text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition-colors"
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
/**
 * Tabbed pricing editor — one tab per (Machine row × supported ball
 * type) combo at the active center. Mirrors the prod ABCA pricing
 * UI, where the tab strip looks like:
 *
 *   [ Gravity·Leather ] [ Yantra·Leather ] [ Gravity·Machine ]
 *   [ Yantra·Machine ] [ Tennis ]
 *
 * For Toplay (RESOURCE_BASED) the tab strip uses Machine row names
 * + ball, and tabs only appear for ball types each machine actually
 * supports — so a Yantra never shows a "Tennis" tab and a Leverage
 * Tennis never shows a "Leather" tab. The "Any" ball that used to
 * sit in the data shape is hidden from the editor entirely; admins
 * always pick a specific ball.
 *
 * Active tab body: 3 pitch sections (Astro Turf, Cement Wicket,
 * Natural Turf), each with 4 inputs — Morn/Slot, Morn/2 Cons.,
 * Eve/Slot, Eve/2 Cons. Same shape as the prod PRICING_CONFIG.
 */

/** Resolve the list of ball types this machine actually supports.
 *  Falls back to the machineType's default ball when nothing's
 *  configured. Tennis-type machines get TENNIS only; leather-type
 *  machines get LEATHER + MACHINE balls (matches main's convention). */
function machineBalls(m: CenterMachineLite): SpecificBall[] {
  if (m.effectiveBallTypes && m.effectiveBallTypes.length > 0) {
    return m.effectiveBallTypes;
  }
  if (m.supportedBallTypes && m.supportedBallTypes.length > 0) {
    return m.supportedBallTypes;
  }
  const fb = m.machineType.ballType;
  if (fb === 'LEATHER') return ['LEATHER', 'MACHINE'];
  if (fb === 'TENNIS') return ['TENNIS'];
  if (fb === 'MACHINE') return ['MACHINE'];
  return ['LEATHER', 'MACHINE', 'TENNIS'];
}

/** Composite tab key encoding `(machineId, ball)`. The matrix is
 *  stored two-deep (matrix[machineId][pitch][ball]) so the active
 *  tab tells us which (machine, ball) pair to show. */
type TabKey = `${string}::${SpecificBall}`;

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
  // Build the flat tab list from the machines × supported balls.
  // Skipping inactive machines is the parent's job (it filters
  // before passing in).
  const tabs: Array<{ key: TabKey; machineId: string; ball: SpecificBall; label: string }> = [];
  for (const m of machines) {
    for (const b of machineBalls(m)) {
      tabs.push({
        key: `${m.id}::${b}` as TabKey,
        machineId: m.id,
        ball: b,
        label: `${m.shortName ?? m.name} · ${BALL_LABELS[b]}`,
      });
    }
  }

  const [activeKey, setActiveKey] = useState<TabKey>(tabs[0]?.key ?? ('' as TabKey));
  // Keep the active tab valid when the machine list changes mid-edit.
  useEffect(() => {
    if (!tabs.find((t) => t.key === activeKey)) {
      setActiveKey(tabs[0]?.key ?? ('' as TabKey));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs.map((t) => t.key).join('|')]);

  const active = tabs.find((t) => t.key === activeKey) ?? tabs[0];

  const cellsConfigured = (machineId: string, ball: SpecificBall): number => {
    const byMachine = matrix[machineId] ?? {};
    let n = 0;
    for (const p of PITCH_KEYS) {
      if (byMachine[p]?.[ball] != null) n++;
    }
    return n;
  };

  if (tabs.length === 0) {
    return (
      <div className="text-[11px] text-slate-500 italic py-2">
        No machines configured at this center yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Tab strip — horizontally scrollable on phones. */}
      <div className="flex gap-1 overflow-x-auto pb-2 scrollbar-hide">
        {tabs.map((t) => {
          const isActive = activeKey === t.key;
          const count = cellsConfigured(t.machineId, t.ball);
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveKey(t.key)}
              className={`flex-shrink-0 px-3 py-2 rounded-lg text-[11px] font-semibold transition-all cursor-pointer whitespace-nowrap ${
                isActive
                  ? 'bg-accent/15 text-accent border border-accent/30'
                  : 'bg-white/[0.03] text-slate-400 border border-white/[0.06] hover:text-slate-200'
              }`}
            >
              {t.label}
              {count > 0 && (
                <span className={`ml-1.5 text-[9px] px-1 rounded ${isActive ? 'bg-accent/20' : 'bg-white/[0.06]'}`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Active tab body — 3 pitch sections, each with 4 inputs. */}
      {active && (
        <div className="space-y-3">
          {PITCH_KEYS.map((pitch) => {
            const cell = matrix[active.machineId]?.[pitch]?.[active.ball];
            const has = cell != null;
            return (
              <div
                key={pitch}
                className="bg-white/[0.02] rounded-xl border border-white/[0.05] p-3 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] font-bold text-slate-300">
                    {PITCH_LABELS[pitch]}
                  </div>
                  <button
                    type="button"
                    onClick={() => onClearCell(active.machineId, pitch, active.ball)}
                    disabled={!has}
                    className="p-1.5 rounded-lg text-red-400/70 hover:bg-red-500/10 hover:text-red-400 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Clear (fall back to category default)"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
                {/* Four inputs per pitch — Morn/Slot, Morn/2 Cons.,
                    Eve/Slot, Eve/2 Cons. Mirrors the prod layout. */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <LabeledPriceInput
                    label="Morn / Slot"
                    value={cell?.morning?.single ?? 0}
                    onChange={(n) => onChange(active.machineId, pitch, active.ball, 'morning', 'single', n)}
                  />
                  <LabeledPriceInput
                    label="Morn / 2 Cons."
                    value={cell?.morning?.consecutive ?? 0}
                    onChange={(n) => onChange(active.machineId, pitch, active.ball, 'morning', 'consecutive', n)}
                  />
                  <LabeledPriceInput
                    label="Eve / Slot"
                    value={cell?.evening?.single ?? 0}
                    onChange={(n) => onChange(active.machineId, pitch, active.ball, 'evening', 'single', n)}
                  />
                  <LabeledPriceInput
                    label="Eve / 2 Cons."
                    value={cell?.evening?.consecutive ?? 0}
                    onChange={(n) => onChange(active.machineId, pitch, active.ball, 'evening', 'consecutive', n)}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Compact labeled-above price input used by the per-machine matrix.
 *  Mirrors the prod editor's "Morn / Slot" / "Morn / 2 Cons." labels. */
function LabeledPriceInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-[10px] font-medium text-slate-400">{label}</label>
      <PriceInput value={value} onChange={onChange} />
    </div>
  );
}

/**
 * Compact pitch × slab × consecutive editor used by SIDEARM and NET.
 * Mirrors the ABCA pricing matrix shape — each pitch row exposes four
 * cells: Morning Single, Morning Consecutive (per pair), Evening
 * Single, Evening Consecutive (per pair).
 *
 * Convention (consistent with `pickRate` in resource-pricing.ts and
 * the machine matrix here): `consecutive` is the TOTAL for a 2-slot
 * pair, so the per-slot price within a consecutive chain is
 * `consecutive / 2`. `single` is already per-slot. The engine accepts
 * either flat numbers or `{single, consecutive}` pairs, so leaving
 * `consecutive` at 0 effectively falls back to category default for
 * back-to-back chains.
 */
function SimplePitchSection({
  title,
  rates,
  onChange,
  onClear,
}: {
  title: string;
  rates: Partial<Record<PitchKey, PairSlabRates>>;
  onChange: (
    pitch: PitchKey,
    slab: 'morning' | 'evening',
    kind: 'single' | 'consecutive',
    n: number,
  ) => void;
  onClear: (pitch: PitchKey) => void;
}) {
  // Responsive layout. On wide screens (sm+) we keep the dense 1-row
  // grid (pitch · 4 prices · clear). On mobile we stack each pitch as
  // a card with a 2×2 grid of labeled inputs so the four prices stay
  // readable without horizontal scroll. Admins reported the dense
  // grid was cramped on phone-sized screens.
  return (
    <div className="space-y-2 pt-3 border-t border-white/[0.04]">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
        {title}
      </div>

      {/* Desktop header row — hidden on mobile (we use card titles instead). */}
      <div className="hidden sm:grid grid-cols-[1fr_repeat(4,minmax(0,_5rem))_auto] gap-2 items-center text-[10px] uppercase tracking-wider text-slate-500">
        <div>Pitch</div>
        <div className="text-center">M. Single</div>
        <div className="text-center">M. 2 Cons.</div>
        <div className="text-center">E. Single</div>
        <div className="text-center">E. 2 Cons.</div>
        <div className="w-7" />
      </div>

      {PITCH_KEYS.map((pitch) => {
        const cell = rates[pitch];
        const has = cell != null;
        return (
          <div
            key={pitch}
            className="rounded-lg sm:rounded-none sm:bg-transparent sm:border-0 sm:p-0 bg-white/[0.02] border border-white/[0.05] p-3"
          >
            {/* Desktop: single row. Mobile: header line + 2x2 input grid below. */}
            <div className="hidden sm:grid grid-cols-[1fr_repeat(4,minmax(0,_5rem))_auto] gap-2 items-center">
              <div className="text-sm text-white truncate">{PITCH_LABELS[pitch]}</div>
              <PriceInput value={cell?.morning?.single ?? 0}      onChange={(n) => onChange(pitch, 'morning', 'single', n)} />
              <PriceInput value={cell?.morning?.consecutive ?? 0} onChange={(n) => onChange(pitch, 'morning', 'consecutive', n)} />
              <PriceInput value={cell?.evening?.single ?? 0}      onChange={(n) => onChange(pitch, 'evening', 'single', n)} />
              <PriceInput value={cell?.evening?.consecutive ?? 0} onChange={(n) => onChange(pitch, 'evening', 'consecutive', n)} />
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

            {/* Mobile: stacked card layout. Pitch name + clear on top,
                then 2×2 grid of labeled inputs. */}
            <div className="sm:hidden">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-semibold text-white">{PITCH_LABELS[pitch]}</div>
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
              <div className="grid grid-cols-2 gap-2">
                <LabeledPriceInput label="M. Single"   value={cell?.morning?.single ?? 0}      onChange={(n) => onChange(pitch, 'morning', 'single', n)} />
                <LabeledPriceInput label="M. 2 Cons."  value={cell?.morning?.consecutive ?? 0} onChange={(n) => onChange(pitch, 'morning', 'consecutive', n)} />
                <LabeledPriceInput label="E. Single"   value={cell?.evening?.single ?? 0}      onChange={(n) => onChange(pitch, 'evening', 'single', n)} />
                <LabeledPriceInput label="E. 2 Cons."  value={cell?.evening?.consecutive ?? 0} onChange={(n) => onChange(pitch, 'evening', 'consecutive', n)} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

