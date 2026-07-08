'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';

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
    },
  ],
};

const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const inputClass =
  'w-full bg-white/[0.04] border border-white/[0.1] text-white placeholder:text-slate-500 rounded-lg px-2.5 py-2 text-xs outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition-colors';

function mergeCorporate(raw: unknown): CorporateState {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CORPORATE, halfMonth: { ...DEFAULT_CORPORATE.halfMonth } };
  const r = raw as Partial<CorporateState> & { halfMonth?: Partial<HalfMonthState>; adhocFee?: number };
  return {
    ...DEFAULT_CORPORATE,
    ...Object.fromEntries(Object.entries(r).filter(([k, v]) => k !== 'halfMonth' && v !== undefined && v !== null)),
    days: Array.isArray(r.days) ? r.days.filter((d) => typeof d === 'number' && d >= 0 && d <= 6) : DEFAULT_CORPORATE.days,
    // Legacy key: configs saved before the Ad-hoc → Regular rename
    // stored the per-session fee as `adhocFee`.
    regularFee: r.regularFee ?? r.adhocFee ?? DEFAULT_CORPORATE.regularFee,
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
    <div className="flex gap-1">
      {DAY_LETTERS.map((letter, day) => {
        const on = value.includes(day);
        return (
          <button
            key={day}
            type="button"
            title={['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day]}
            onClick={() =>
              onChange(on ? value.filter((d) => d !== day) : [...value, day].sort((a, b) => a - b))
            }
            className={`w-7 h-7 rounded-md text-[10px] font-bold border transition-all cursor-pointer ${
              on
                ? 'bg-accent text-primary border-accent'
                : 'bg-white/[0.04] text-slate-500 border-white/[0.08] hover:border-accent/30'
            }`}
          >
            {letter}
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
      <label className="block text-[10px] font-medium text-slate-400 mb-1">{label}</label>
      {children}
    </div>
  );
}

export function MatchPracticeConfigEditor({
  scope,
  centerLabel,
  externalSaveTrigger,
  onSaveStatus,
}: {
  scope: 'center' | 'global';
  centerLabel: string;
  externalSaveTrigger?: number;
  onSaveStatus?: (status: { saving: boolean; message: { text: string; ok: boolean } | null }) => void;
}) {
  const [corp, setCorp] = useState<CorporateState>(DEFAULT_CORPORATE);
  const [sim, setSim] = useState<SimState>(DEFAULT_SIM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/admin/policies?scope=${scope}`);
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
  }, [scope]);

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
      const [r1, r2] = await Promise.all([
        post('CORPORATE_BATCH_CONFIG', corp),
        post('MATCH_SIMULATION_CONFIG', sim),
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
  }, [scope, corp, sim, centerLabel]);

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
            <input type="number" min={0} value={corp.monthlyFee} className={inputClass}
              onChange={(e) => setCorp((p) => ({ ...p, monthlyFee: Math.max(0, Number(e.target.value) || 0) }))} />
          </Field>
          <Field label="Regular Fee (₹/session)">
            <input type="number" min={0} value={corp.regularFee} className={inputClass}
              onChange={(e) => setCorp((p) => ({ ...p, regularFee: Math.max(0, Number(e.target.value) || 0) }))} />
          </Field>
          <Field label="Max Batch Capacity">
            <input type="number" min={1} value={corp.maxCapacity} className={inputClass}
              onChange={(e) => setCorp((p) => ({ ...p, maxCapacity: Math.max(1, Number(e.target.value) || 1) }))} />
          </Field>
          <Field label="Indoor Nets Held">
            <input type="number" min={0} value={corp.netsConsumed} className={inputClass}
              onChange={(e) => setCorp((p) => ({ ...p, netsConsumed: Math.max(0, Number(e.target.value) || 0) }))} />
          </Field>
        </div>
        <p className="text-[10px] text-slate-500 leading-relaxed">
          Frequency ({corp.days.length} day{corp.days.length === 1 ? '' : 's'}/week) follows the
          selected batch days. &lsquo;Indoor Nets Held&rsquo; is how many nets the batch reserves
          from the regular slot grid during its window.
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
                <input type="number" min={0} value={corp.halfMonth.fee} className={inputClass}
                  onChange={(e) => setCorp((p) => ({ ...p, halfMonth: { ...p.halfMonth, fee: Math.max(0, Number(e.target.value) || 0) } }))} />
              </Field>
              <Field label="First Half Ends On (day)">
                <input type="number" min={1} max={27} value={corp.halfMonth.splitDay} className={inputClass}
                  onChange={(e) => setCorp((p) => ({ ...p, halfMonth: { ...p.halfMonth, splitDay: Math.min(27, Math.max(1, Number(e.target.value) || 15)) } }))} />
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
                    <input type="number" min={1} value={s.capacity} title="Max participants" className={inputClass}
                      onChange={(e) => updateSession(s.id, { capacity: Math.max(1, Number(e.target.value) || 1) })} />
                    <input type="number" min={0} value={s.fee} title="Session fee" className={inputClass}
                      onChange={(e) => updateSession(s.id, { fee: Math.max(0, Number(e.target.value) || 0) })} />
                  </div>
                </Field>
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
