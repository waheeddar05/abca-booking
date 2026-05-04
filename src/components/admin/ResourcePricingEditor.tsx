'use client';

import { useEffect, useState } from 'react';
import { IndianRupee, Loader2, Save, Plus, Trash2 } from 'lucide-react';

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

interface ResourcePricingValue {
  categoryRates: Record<CategoryKey, SlabRates>;
  machineTypeOverrides?: Record<string, SlabRates>;
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
  return { categoryRates: filled, machineTypeOverrides: overrides };
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
  const [machineTypes, setMachineTypes] = useState<Array<{ code: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  // Fetch the resolved RESOURCE_PRICING_CONFIG for the active scope.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [policyRes, mtRes] = await Promise.all([
          fetch(`/api/admin/policies?scope=${scope}`),
          // Machine type catalog — used to populate the "add override" picker.
          fetch('/api/admin/machine-types').then((r) => (r.ok ? r.json() : [])),
        ]);
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
        const mtRows: Array<{ code: string; name: string }> = Array.isArray(mtRes) ? mtRes : [];
        setMachineTypes(mtRows.filter((m) => m.code && m.name));
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

  const setOverrideRate = (code: string, slab: 'morning' | 'evening', n: number) => {
    setValue((prev) => ({
      ...prev,
      machineTypeOverrides: {
        ...(prev.machineTypeOverrides ?? {}),
        [code]: { ...(prev.machineTypeOverrides?.[code] ?? { morning: 0, evening: 0 }), [slab]: n },
      },
    }));
  };

  const addOverride = (code: string) => {
    if (!code) return;
    setValue((prev) => ({
      ...prev,
      machineTypeOverrides: {
        ...(prev.machineTypeOverrides ?? {}),
        [code]: prev.machineTypeOverrides?.[code] ?? { ...prev.categoryRates.MACHINE },
      },
    }));
  };

  const removeOverride = (code: string) => {
    setValue((prev) => {
      const next = { ...(prev.machineTypeOverrides ?? {}) };
      delete next[code];
      return { ...prev, machineTypeOverrides: next };
    });
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

  const overrideEntries = Object.entries(value.machineTypeOverrides ?? {});
  const availableTypesToAdd = machineTypes.filter(
    (m) => !overrideEntries.find(([code]) => code === m.code),
  );

  return (
    <div className="space-y-4">
      {/* Per-category rate matrix */}
      <div className="space-y-2">
        <div className="grid grid-cols-[1fr_auto_auto] gap-3 items-center text-[10px] uppercase tracking-wider text-slate-500 font-semibold pb-1 border-b border-white/[0.04]">
          <div>Category</div>
          <div className="w-28 text-center">Morning</div>
          <div className="w-28 text-center">Evening</div>
        </div>
        {CATEGORY_ORDER.map((cat) => (
          <div key={cat} className="grid grid-cols-[1fr_auto_auto] gap-3 items-center">
            <div className="text-sm text-white">{CATEGORY_LABELS[cat]}</div>
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

      {/* Per-machine-type overrides for MACHINE category */}
      <div className="space-y-2 pt-2">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
          Machine type overrides
        </div>
        <div className="text-[11px] text-slate-500 leading-relaxed">
          Override the Bowling Machine rate for specific machine types
          (e.g. premium for Yantra). Empty list ⇒ every machine uses the
          base Bowling Machine rate above.
        </div>

        {overrideEntries.length === 0 ? (
          <div className="text-[11px] text-slate-600 italic py-1">
            No machine-type overrides set.
          </div>
        ) : (
          <div className="space-y-1.5">
            {overrideEntries.map(([code, rates]) => {
              const meta = machineTypes.find((m) => m.code === code);
              return (
                <div
                  key={code}
                  className="grid grid-cols-[1fr_auto_auto_auto] gap-3 items-center"
                >
                  <div className="text-sm text-white">
                    {meta?.name ?? code}
                    <span className="ml-1.5 text-[10px] text-slate-500 font-mono">{code}</span>
                  </div>
                  <PriceInput
                    value={rates.morning}
                    onChange={(n) => setOverrideRate(code, 'morning', n)}
                  />
                  <PriceInput
                    value={rates.evening}
                    onChange={(n) => setOverrideRate(code, 'evening', n)}
                  />
                  <button
                    type="button"
                    onClick={() => removeOverride(code)}
                    className="p-1.5 rounded-lg text-red-400/70 hover:bg-red-500/10 hover:text-red-400 cursor-pointer"
                    title="Remove override"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {availableTypesToAdd.length > 0 && (
          <div className="flex items-center gap-2 pt-1.5">
            <select
              defaultValue=""
              onChange={(e) => {
                const code = e.target.value;
                if (code) {
                  addOverride(code);
                  e.currentTarget.value = '';
                }
              }}
              className="bg-white/[0.04] border border-white/[0.1] text-white rounded-lg px-2 py-1.5 text-xs outline-none focus:border-accent"
            >
              <option value="" disabled>+ Add machine-type override…</option>
              {availableTypesToAdd.map((m) => (
                <option key={m.code} value={m.code}>{m.name} ({m.code})</option>
              ))}
            </select>
            <Plus className="w-3.5 h-3.5 text-slate-500" />
          </div>
        )}
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
    <div className="relative w-28">
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
