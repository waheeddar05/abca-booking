'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';

// A physical Resource type maps to a bookable pitch type. NET is the
// indoor synthetic-turf pool → Astro; TURF_WICKET → Natural; CEMENT_WICKET
// → Cement. Keep in sync with resource-booking.ts `resourceMatchesPitch`.
type ResourceType = 'NET' | 'TURF_WICKET' | 'CEMENT_WICKET' | 'COURT';
type PitchKey = 'ASTRO' | 'NATURAL' | 'CEMENT';
type WicketsHeld = Partial<Record<PitchKey, number>>;

const TYPE_TO_PITCH: Partial<Record<ResourceType, PitchKey>> = {
  NET: 'ASTRO',
  TURF_WICKET: 'NATURAL',
  CEMENT_WICKET: 'CEMENT',
};
const PITCH_LABELS: Record<PitchKey, string> = {
  ASTRO: 'Astro Turf',
  NATURAL: 'Natural Turf',
  CEMENT: 'Cement',
};
// Canonical render order regardless of the order resources come back in.
const PITCH_ORDER: PitchKey[] = ['ASTRO', 'NATURAL', 'CEMENT'];

type PitchOption = { pitch: PitchKey; label: string; available: number };

/** Keep only known pitch keys with positive integer counts. */
function cleanWickets(raw: unknown): WicketsHeld {
  if (!raw || typeof raw !== 'object') return {};
  const out: WicketsHeld = {};
  for (const p of PITCH_ORDER) {
    const v = (raw as Record<string, unknown>)[p];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[p] = Math.floor(v);
  }
  return out;
}

/**
 * Admin editor for the Match Practice booking category:
 *
 *   - Corporate Batch (CORPORATE_BATCH_CONFIG policy): batch days,
 *     timings, coach, monthly fee, regular fee, max capacity, nets held,
 *     and half-month payment (enabled / fee / applicable halves / split
 *     day). The same policy key also drives the resource engine's
 *     indoor-net hold, so existing values are preserved on save.
 *
 *   - Match Simulation (MATCH_SIMULATION_CONFIG policy): CRUD over
 *     sessions — each with active days, one time slot, capacity, fee,
 *     optional coach, and an enable/disable toggle. Multiple sessions
 *     per day are supported (e.g. 7–9 AM and 8–10 PM).
 *
 * Persists via the scope-aware /api/admin/policies endpoint, matching
 * EnabledCategoriesEditor's save conventions (externalSaveTrigger +
 * onSaveStatus for the page-level "Save All Settings" button).
 */

interface HalfMonthState {
  enabled: boolean;
  fee: number;
  firstHalf: boolean;
  secondHalf: boolean;
  splitDay: number;
}

interface CorporateState {
  enabled: boolean;
  days: number[];
  startTime: string;
  endTime: string;
  netsConsumed: number;
  wicketsHeld: WicketsHeld;
  coachName: string;
  monthlyFee: number;
  regularFee: number;
  maxCapacity: number;
  halfMonth: HalfMonthState;
}

interface SimSessionState {
  id: string;
  label: string;
  days: number[];
  startTime: string;
  endTime: string;
  capacity: number;
  fee: number;
  coachName: string;
  enabled: boolean;
  wicketsHeld: WicketsHeld;
}

interface SimState {
  enabled: boolean;
  sessions: SimSessionState[];
}

// Client-side mirror of the server defaults in src/lib/match-practice.ts.
const DEFAULT_CORPORATE: CorporateState = {
  enabled: false,
  days: [1, 3, 5],
  startTime: '07:00',
  endTime: '09:00',
  netsConsumed: 2,
  wicketsHeld: {},
  coachName: 'Govind Lashkare',
  monthlyFee: 2000,
  regularFee: 200,
  maxCapacity: 25,
  halfMonth: { enabled: false, fee: 1000, firstHalf: true, secondHalf: true, splitDay: 15 },
};

const DEFAULT_SIM: SimState = {
  enabled: false,
  sessions: [
    {
      id: 'ms-default',
      label: 'Morning Batch',
      days: [0, 2, 4, 5, 6],
      startTime: '07:00',
      endTime: '09:00',
      capacity: 10,
      fee: 200,
      coachName: '',
      enabled: true,
      wicketsHeld: {},
    },
  ],
};

// Full weekday labels + chip styling mirror the app-wide day picker on
// the Offers page, so weekday selection looks and feels identical across
// the whole application.
const DAY_OPTIONS = [
  { id: 0, label: 'Sun' },
  { id: 1, label: 'Mon' },
  { id: 2, label: 'Tue' },
  { id: 3, label: 'Wed' },
  { id: 4, label: 'Thu' },
  { id: 5, label: 'Fri' },
  { id: 6, label: 'Sat' },
];

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Shared input styling matches the rest of the admin forms (e.g. Offers):
// text-sm, px-3 py-2.5 — consistent font size, field height and spacing.
const inputClass =
  'w-full bg-white/[0.04] border border-white/[0.1] text-white placeholder:text-slate-500 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition-colors';

const dayChipClass = (active: boolean) =>
  `px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
    active
      ? 'bg-accent/20 text-accent border border-accent/40'
      : 'bg-white/[0.04] text-slate-400 border border-white/[0.08] hover:border-white/20'
  }`;

function mergeCorporate(raw: unknown): CorporateState {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CORPORATE, halfMonth: { ...DEFAULT_CORPORATE.halfMonth } };
  const r = raw as Partial<CorporateState> & { halfMonth?: Partial<HalfMonthState>; adhocFee?: number };
  return {
    ...DEFAULT_CORPORATE,
    ...Object.fromEntries(Object.entries(r).filter(([k, v]) => k !== 'halfMonth' && k !== 'wicketsHeld' && v !== undefined && v !== null)),
    days: Array.isArray(r.days) ? r.days.filter((d) => typeof d === 'number' && d >= 0 && d <= 6) : DEFAULT_CORPORATE.days,
    // Legacy key: configs saved before the Ad-hoc → Regular rename
    // stored the per-session fee as `adhocFee`.
    regularFee: r.regularFee ?? r.adhocFee ?? DEFAULT_CORPORATE.regularFee,
    // Per-pitch wickets held. Falls back to the legacy `netsConsumed`
    // (Astro) count so old configs pre-fill the Astro field.
    wicketsHeld: (() => {
      const cleaned = cleanWickets(r.wicketsHeld);
      if (Object.keys(cleaned).length > 0) return cleaned;
      const legacy = typeof r.netsConsumed === 'number' && r.netsConsumed > 0 ? r.netsConsumed : 0;
      return legacy > 0 ? { ASTRO: Math.floor(legacy) } : {};
    })(),
    halfMonth: { ...DEFAULT_CORPORATE.halfMonth, ...(r.halfMonth ?? {}) },
  } as CorporateState;
}

function mergeSim(raw: unknown): SimState {
  if (!raw || typeof raw !== 'object') {
    return { enabled: DEFAULT_SIM.enabled, sessions: DEFAULT_SIM.sessions.map((s) => ({ ...s })) };
  }
  const r = raw as Partial<SimState>;
  const sessions = Array.isArray(r.sessions) && r.sessions.length > 0
    ? r.sessions.map((s, i) => ({
        id: s?.id || `ms-${Date.now()}-${i}`,
        label: s?.label ?? '',
        days: Array.isArray(s?.days) ? s.days.filter((d) => typeof d === 'number' && d >= 0 && d <= 6) : [],
        startTime: s?.startTime || '07:00',
        endTime: s?.endTime || '09:00',
        capacity: typeof s?.capacity === 'number' ? s.capacity : 10,
        fee: typeof s?.fee === 'number' ? s.fee : 200,
        coachName: s?.coachName ?? '',
        enabled: s?.enabled !== false,
        wicketsHeld: cleanWickets((s as { wicketsHeld?: unknown })?.wicketsHeld),
      }))
    : DEFAULT_SIM.sessions.map((s) => ({ ...s }));
  return { enabled: r.enabled === true, sessions };
}

function DayChips({
  value,
  onChange,
}: {
  value: number[];
  onChange: (days: number[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {DAY_OPTIONS.map(({ id, label }) => {
        const on = value.includes(id);
        return (
          <button
            key={id}
            type="button"
            title={DAY_NAMES[id]}
            onClick={() =>
              onChange(on ? value.filter((d) => d !== id) : [...value, id].sort((a, b) => a - b))
            }
            className={dayChipClass(on)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function ToggleRow({
  label,
  sub,
  on,
  onToggle,
}: {
  label: string;
  sub?: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-xl text-left border transition-all cursor-pointer ${
        on
          ? 'bg-accent/10 text-accent border-accent/20'
          : 'bg-black/20 text-slate-500 border-white/[0.05] hover:border-white/[0.1]'
      }`}
    >
      <div className="min-w-0">
        <span className={`text-xs font-semibold ${on ? 'text-white' : 'text-slate-400'}`}>{label}</span>
        {sub && <span className="ml-2 text-[9px] text-slate-500 uppercase tracking-tight">{sub}</span>}
      </div>
      <div className={`w-4 h-4 flex-shrink-0 rounded-full border flex items-center justify-center ${
        on ? 'bg-accent border-accent text-primary' : 'border-white/10 bg-white/5'
      }`}>
        {on && (
          <svg className="w-2 h-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={4} d="M5 13l4 4L19 7" />
          </svg>
        )}
      </div>
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-slate-400 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

/**
 * Amount / count input that can be fully cleared while editing.
 *
 * The naive `value={num}` + `Number(e.target.value) || 0` pattern snaps
 * the field back to 0 the moment a user deletes the last digit, so an
 * existing value can never be wiped before typing a replacement. This
 * keeps a local string draft instead: the field may sit empty mid-edit,
 * valid numbers propagate to the parent as they're typed, and on blur an
 * empty or invalid value is normalized to the clamped minimum.
 */
function NumberInput({
  value,
  onChange,
  min,
  max,
  title,
  className,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  title?: string;
  className?: string;
}) {
  // The draft initializes from the loaded value: the parent gates the
  // whole form behind a `loading` spinner, so every NumberInput mounts
  // only after the policy fetch resolves — no external value changes
  // reach a mounted instance, so no sync effect is needed.
  const [draft, setDraft] = useState(String(value));

  const clamp = (n: number) => {
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    return n;
  };

  return (
    <input
      type="number"
      inputMode="numeric"
      value={draft}
      min={min}
      max={max}
      title={title}
      className={className ?? inputClass}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        // Propagate only when the field holds a valid number; an empty
        // field leaves the parent value untouched until blur.
        if (raw.trim() !== '' && Number.isFinite(Number(raw))) {
          onChange(clamp(Number(raw)));
        }
      }}
      onBlur={(e) => {
        const raw = e.target.value.trim();
        const next =
          raw === '' || !Number.isFinite(Number(raw)) ? (min ?? 0) : clamp(Number(raw));
        setDraft(String(next));
        onChange(next);
      }}
    />
  );
}

/**
 * Dynamic "<Pitch> Wickets Held" inputs — one field per pitch type the
 * center has configured (My Center → Pitch Types). Renders a hint when no
 * pitch types exist so admins know where to add them.
 */
function PitchWicketsFields({
  centerId,
  options,
  values,
  onChange,
}: {
  centerId?: string;
  options: PitchOption[];
  values: WicketsHeld;
  onChange: (pitch: PitchKey, value: number) => void;
}) {
  if (options.length === 0) {
    return (
      <p className="text-[10px] text-slate-500 leading-relaxed">
        No pitch types configured yet. Add them under{' '}
        {centerId ? (
          <a href={`/admin/centers/${centerId}`} className="text-accent underline">My Center → Pitch Types</a>
        ) : (
          <span className="text-slate-400">My Center → Pitch Types</span>
        )}{' '}
        to reserve wickets here.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
      {options.map((opt) => (
        <Field key={opt.pitch} label={`${opt.label} Wickets Held`}>
          <NumberInput
            min={0}
            max={opt.available}
            value={values[opt.pitch] ?? 0}
            title={`${opt.available} ${opt.label} configured`}
            onChange={(v) => onChange(opt.pitch, v)}
          />
        </Field>
      ))}
    </div>
  );
}

export function MatchPracticeConfigEditor({
  scope,
  centerId,
  centerLabel,
  externalSaveTrigger,
  onSaveStatus,
}: {
  scope: 'center' | 'global';
  /** Current center — used to load the configured pitch types (Resource
   *  rows) that drive the dynamic per-pitch "Wickets Held" fields. */
  centerId?: string;
  centerLabel: string;
  externalSaveTrigger?: number;
  onSaveStatus?: (status: { saving: boolean; message: { text: string; ok: boolean } | null }) => void;
}) {
  const [corp, setCorp] = useState<CorporateState>(DEFAULT_CORPORATE);
  const [sim, setSim] = useState<SimState>(DEFAULT_SIM);
  const [pitchOptions, setPitchOptions] = useState<PitchOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        // Load policies + (when we know the center) its configured pitch
        // types in parallel. Pitch types drive which "Wickets Held" inputs
        // render; missing centerId just yields no dynamic fields.
        const [res, resourcesRes] = await Promise.all([
          fetch(`/api/admin/policies?scope=${scope}`),
          centerId
            ? fetch(`/api/admin/centers/${centerId}/resources`).then((r) => (r.ok ? r.json() : []))
            : Promise.resolve([]),
        ]);
        if (cancelled) return;

        const counts: Partial<Record<PitchKey, number>> = {};
        const resources: Array<{ type: ResourceType; isActive?: boolean }> = Array.isArray(resourcesRes) ? resourcesRes : [];
        for (const r of resources) {
          if (r.isActive === false) continue;
          const pitch = TYPE_TO_PITCH[r.type];
          if (!pitch) continue;
          counts[pitch] = (counts[pitch] ?? 0) + 1;
        }
        setPitchOptions(
          PITCH_ORDER.filter((p) => (counts[p] ?? 0) > 0).map((p) => ({
            pitch: p,
            label: PITCH_LABELS[p],
            available: counts[p] ?? 0,
          })),
        );

        if (!res.ok) return;
        const rows: Array<{ key: string; value: string }> = await res.json();
        if (cancelled) return;
        const parse = (key: string): unknown => {
          const row = rows.find((r) => r.key === key);
          if (!row) return null;
          try { return JSON.parse(row.value); } catch { return null; }
        };
        setCorp(mergeCorporate(parse('CORPORATE_BATCH_CONFIG')));
        setSim(mergeSim(parse('MATCH_SIMULATION_CONFIG')));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [scope, centerId]);

  const save = useCallback(async () => {
    setSaving(true);
    setMessage(null);
    try {
      const post = (key: string, value: unknown) =>
        fetch(`/api/admin/policies?scope=${scope}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, value: JSON.stringify(value) }),
        });
      // Persist only wickets for pitch types the center actually has
      // configured, and keep the legacy `netsConsumed` mirror in sync with
      // the Astro count so older readers stay correct.
      const validPitches = new Set(pitchOptions.map((o) => o.pitch));
      const pruneWickets = (w: WicketsHeld): WicketsHeld => {
        const out: WicketsHeld = {};
        for (const p of PITCH_ORDER) {
          if (validPitches.has(p) && (w[p] ?? 0) > 0) out[p] = w[p];
        }
        return out;
      };
      const corpWickets = pruneWickets(corp.wicketsHeld);
      const corpPayload = { ...corp, wicketsHeld: corpWickets, netsConsumed: corpWickets.ASTRO ?? 0 };
      const simPayload = {
        ...sim,
        sessions: sim.sessions.map((s) => ({ ...s, wicketsHeld: pruneWickets(s.wicketsHeld) })),
      };
      const [r1, r2] = await Promise.all([
        post('CORPORATE_BATCH_CONFIG', corpPayload),
        post('MATCH_SIMULATION_CONFIG', simPayload),
      ]);
      if (!r1.ok || !r2.ok) {
        const bad = !r1.ok ? r1 : r2;
        const body = await bad.json().catch(() => ({}));
        setMessage({ text: body?.error || 'Save failed', ok: false });
        return;
      }
      setMessage({ text: `Saved for ${centerLabel}`, ok: true });
      setTimeout(() => setMessage(null), 3500);
    } finally {
      setSaving(false);
    }
  }, [scope, corp, sim, pitchOptions, centerLabel]);

  useEffect(() => {
    if (externalSaveTrigger && externalSaveTrigger > 0) {
      save();
    }
    // Fire only when the trigger counter bumps — mirrors the other
    // trigger-driven editors on this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalSaveTrigger]);

  useEffect(() => {
    onSaveStatus?.({ saving, message });
  }, [saving, message, onSaveStatus]);

  const updateSession = (id: string, patch: Partial<SimSessionState>) => {
    setSim((prev) => ({
      ...prev,
      sessions: prev.sessions.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    }));
  };

  const setCorpWicket = (pitch: PitchKey, value: number) => {
    setCorp((p) => {
      const w = { ...p.wicketsHeld };
      if (value > 0) w[pitch] = value; else delete w[pitch];
      return { ...p, wicketsHeld: w };
    });
  };

  const setSessionWicket = (id: string, pitch: PitchKey, value: number) => {
    setSim((prev) => ({
      ...prev,
      sessions: prev.sessions.map((s) => {
        if (s.id !== id) return s;
        const w = { ...s.wicketsHeld };
        if (value > 0) w[pitch] = value; else delete w[pitch];
        return { ...s, wicketsHeld: w };
      }),
    }));
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-slate-400 py-6 justify-center text-sm">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ─── Corporate Batch ─────────────────────────────────────── */}
      <div className="bg-white/[0.02] rounded-xl border border-white/[0.05] p-3 space-y-3">
        <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
          Corporate Batch
        </h3>
        <ToggleRow
          label="Enable Corporate Batch"
          sub="Monthly + regular enrollment"
          on={corp.enabled}
          onToggle={() => setCorp((p) => ({ ...p, enabled: !p.enabled }))}
        />

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          <Field label="Batch Days">
            <DayChips value={corp.days} onChange={(days) => setCorp((p) => ({ ...p, days }))} />
          </Field>
          <Field label="Start Time">
            <input type="time" value={corp.startTime} className={inputClass}
              onChange={(e) => setCorp((p) => ({ ...p, startTime: e.target.value }))} />
          </Field>
          <Field label="End Time">
            <input type="time" value={corp.endTime} className={inputClass}
              onChange={(e) => setCorp((p) => ({ ...p, endTime: e.target.value }))} />
          </Field>
          <Field label="Coach">
            <input type="text" value={corp.coachName} placeholder="Coach name" className={inputClass}
              onChange={(e) => setCorp((p) => ({ ...p, coachName: e.target.value }))} />
          </Field>
          <Field label="Monthly Fee (₹)">
            <NumberInput min={0} value={corp.monthlyFee}
              onChange={(v) => setCorp((p) => ({ ...p, monthlyFee: v }))} />
          </Field>
          <Field label="Regular Fee (₹/session)">
            <NumberInput min={0} value={corp.regularFee}
              onChange={(v) => setCorp((p) => ({ ...p, regularFee: v }))} />
          </Field>
          <Field label="Max Batch Capacity">
            <NumberInput min={1} value={corp.maxCapacity}
              onChange={(v) => setCorp((p) => ({ ...p, maxCapacity: v }))} />
          </Field>
        </div>

        {/* Per-pitch wickets held — dynamic from the center's pitch types. */}
        <div className="pt-1">
          <label className="block text-[11px] font-semibold text-slate-300 uppercase tracking-wide mb-1.5">
            Wickets Held Per Pitch Type
          </label>
          <PitchWicketsFields
            centerId={centerId}
            options={pitchOptions}
            values={corp.wicketsHeld}
            onChange={setCorpWicket}
          />
        </div>
        <p className="text-[10px] text-slate-500 leading-relaxed">
          Frequency ({corp.days.length} day{corp.days.length === 1 ? '' : 's'}/week) follows the
          selected batch days. &lsquo;Wickets Held&rsquo; is how many wickets of each pitch type the
          batch reserves from the regular slot grid during its window — configured per pitch type
          from My Center.
        </p>

        {/* Half-month payment */}
        <div className="pt-2 border-t border-white/[0.06] space-y-2.5">
          <ToggleRow
            label="Half-Month Payment"
            sub="Optional split enrollment"
            on={corp.halfMonth.enabled}
            onToggle={() => setCorp((p) => ({ ...p, halfMonth: { ...p.halfMonth, enabled: !p.halfMonth.enabled } }))}
          />
          {corp.halfMonth.enabled && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <Field label="Half-Month Fee (₹)">
                <NumberInput min={0} value={corp.halfMonth.fee}
                  onChange={(v) => setCorp((p) => ({ ...p, halfMonth: { ...p.halfMonth, fee: v } }))} />
              </Field>
              <Field label="First Half Ends On (day)">
                <NumberInput min={1} max={27} value={corp.halfMonth.splitDay}
                  onChange={(v) => setCorp((p) => ({ ...p, halfMonth: { ...p.halfMonth, splitDay: v } }))} />
              </Field>
              <Field label="First Half">
                <ToggleRow
                  label={corp.halfMonth.firstHalf ? 'Allowed' : 'Hidden'}
                  on={corp.halfMonth.firstHalf}
                  onToggle={() => setCorp((p) => ({ ...p, halfMonth: { ...p.halfMonth, firstHalf: !p.halfMonth.firstHalf } }))}
                />
              </Field>
              <Field label="Second Half">
                <ToggleRow
                  label={corp.halfMonth.secondHalf ? 'Allowed' : 'Hidden'}
                  on={corp.halfMonth.secondHalf}
                  onToggle={() => setCorp((p) => ({ ...p, halfMonth: { ...p.halfMonth, secondHalf: !p.halfMonth.secondHalf } }))}
                />
              </Field>
            </div>
          )}
        </div>
      </div>

      {/* ─── Match Simulation ────────────────────────────────────── */}
      <div className="bg-white/[0.02] rounded-xl border border-white/[0.05] p-3 space-y-3">
        <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
          Match Simulation
        </h3>
        <ToggleRow
          label="Enable Match Simulation"
          sub="Seat-based group sessions"
          on={sim.enabled}
          onToggle={() => setSim((p) => ({ ...p, enabled: !p.enabled }))}
        />

        <div className="space-y-2.5">
          {sim.sessions.map((s, idx) => (
            <div key={s.id} className={`rounded-xl border p-2.5 space-y-2.5 ${
              s.enabled ? 'border-white/[0.08] bg-white/[0.02]' : 'border-white/[0.05] bg-black/20 opacity-70'
            }`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Session {idx + 1}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => updateSession(s.id, { enabled: !s.enabled })}
                    className={`px-2 py-1 rounded-md text-[10px] font-semibold border cursor-pointer transition-all ${
                      s.enabled
                        ? 'bg-green-500/10 text-green-400 border-green-500/20'
                        : 'bg-white/[0.04] text-slate-500 border-white/[0.08]'
                    }`}
                  >
                    {s.enabled ? 'Enabled' : 'Disabled'}
                  </button>
                  <button
                    type="button"
                    title="Delete session"
                    onClick={() => setSim((p) => ({ ...p, sessions: p.sessions.filter((x) => x.id !== s.id) }))}
                    className="p-1.5 rounded-md text-red-400/70 hover:text-red-400 hover:bg-red-500/10 cursor-pointer transition-all"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                <Field label="Label">
                  <input type="text" value={s.label} placeholder="e.g. Morning Batch" className={inputClass}
                    onChange={(e) => updateSession(s.id, { label: e.target.value })} />
                </Field>
                <Field label="Active Days">
                  <DayChips value={s.days} onChange={(days) => updateSession(s.id, { days })} />
                </Field>
                <Field label="Coach (optional)">
                  <input type="text" value={s.coachName} placeholder="Coach name" className={inputClass}
                    onChange={(e) => updateSession(s.id, { coachName: e.target.value })} />
                </Field>
                <Field label="Start Time">
                  <input type="time" value={s.startTime} className={inputClass}
                    onChange={(e) => updateSession(s.id, { startTime: e.target.value })} />
                </Field>
                <Field label="End Time">
                  <input type="time" value={s.endTime} className={inputClass}
                    onChange={(e) => updateSession(s.id, { endTime: e.target.value })} />
                </Field>
                <Field label="Capacity / Fee (₹)">
                  <div className="grid grid-cols-2 gap-1.5">
                    <NumberInput min={1} value={s.capacity} title="Max participants"
                      onChange={(v) => updateSession(s.id, { capacity: v })} />
                    <NumberInput min={0} value={s.fee} title="Session fee"
                      onChange={(v) => updateSession(s.id, { fee: v })} />
                  </div>
                </Field>
              </div>
              {/* Per-pitch wickets held for this session — dynamic from the
                  center's configured pitch types. */}
              <div className="pt-1.5 border-t border-white/[0.05]">
                <label className="block text-[11px] font-semibold text-slate-300 uppercase tracking-wide mb-1.5">
                  Wickets Held Per Pitch Type
                </label>
                <PitchWicketsFields
                  centerId={centerId}
                  options={pitchOptions}
                  values={s.wicketsHeld}
                  onChange={(pitch, value) => setSessionWicket(s.id, pitch, value)}
                />
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() =>
            setSim((p) => ({
              ...p,
              sessions: [
                ...p.sessions,
                {
                  id: `ms-${Date.now()}`,
                  label: '',
                  days: [],
                  startTime: '19:00',
                  endTime: '21:00',
                  capacity: 10,
                  fee: 200,
                  coachName: '',
                  enabled: true,
                  wicketsHeld: {},
                },
              ],
            }))
          }
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-xs font-semibold text-slate-300 hover:border-accent/30 cursor-pointer transition-all"
        >
          <Plus className="w-3.5 h-3.5" /> Add Session
        </button>
        <p className="text-[10px] text-slate-500 leading-relaxed">
          Multiple sessions per day are supported — users see every enabled session that falls on
          a given date. Capacity is tracked per session per date.
        </p>
      </div>

      {externalSaveTrigger === undefined && (
        <div className="flex items-center justify-end gap-2 pt-1">
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
      )}
    </div>
  );
}
