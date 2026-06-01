'use client';

/**
 * Admin editor for the three per-category pitch-type allowlists:
 *
 *   SIDEARM_PITCH_TYPES  — which pitches admins offer in Sidearm
 *   NET_PITCH_TYPES      — which pitches admins offer in Cricket Nets
 *   COACHING_PITCH_TYPES — which pitches admins offer in Personal
 *                          Coaching (read by ResourceSlotsPage on the
 *                          coaching tab)
 *
 * Each list is stored as a JSON array on `CenterPolicy` (resource-based
 * centers) — e.g. `["ASTRO","NATURAL"]` to hide Cement on cricket nets.
 * When the policy isn't set the engine falls back to every pitch, which
 * is why admins were seeing "Cement Wicket" on Cricket Nets even though
 * they hadn't intended to offer it.
 *
 * The previous workflow was editing raw JSON in the Policies tab. This
 * component replaces that with chip toggles — one row per category,
 * three chips per row — and writes via /api/admin/policies?scope=center.
 */

import { useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';

type PitchKey = 'ASTRO' | 'CEMENT' | 'NATURAL';
const PITCHES: Array<{ id: PitchKey; label: string }> = [
  { id: 'ASTRO',   label: 'Astro Turf' },
  { id: 'CEMENT',  label: 'Cement Wicket' },
  { id: 'NATURAL', label: 'Natural Turf' },
];

type CategoryKey = 'MACHINE' | 'SIDEARM' | 'NET' | 'COACHING';
const CATEGORIES: Array<{
  id: CategoryKey;
  label: string;
  sub: string;
  policyKey: 'MACHINE_PITCH_TYPES' | 'SIDEARM_PITCH_TYPES' | 'NET_PITCH_TYPES' | 'COACHING_PITCH_TYPES';
}> = [
  { id: 'MACHINE',  label: 'Bowling Machine',   sub: 'Yantra / Leverage',  policyKey: 'MACHINE_PITCH_TYPES' },
  { id: 'NET',      label: 'Cricket Nets',      sub: 'Bare-net practice',  policyKey: 'NET_PITCH_TYPES' },
  { id: 'SIDEARM',  label: 'Sidearm',           sub: 'Bowled by a specialist', policyKey: 'SIDEARM_PITCH_TYPES' },
  { id: 'COACHING', label: 'Personal Coaching', sub: 'With a coach',        policyKey: 'COACHING_PITCH_TYPES' },
];

export function EnabledPitchTypesEditor({
  scope,
  externalSaveTrigger,
  onSaveStatus,
}: {
  scope: 'center' | 'global';
  externalSaveTrigger?: number;
  onSaveStatus?: (status: { saving: boolean; message: { text: string; ok: boolean } | null }) => void;
}) {
  // selections[category] is the set of pitches enabled. Empty set = "no
  // pitches at all" — we treat that as falling back to every pitch,
  // same as the engine policy default, so admins can't accidentally
  // remove every option.
  const [selections, setSelections] = useState<Record<CategoryKey, Set<PitchKey>>>({
    MACHINE:  new Set(['ASTRO', 'CEMENT', 'NATURAL']),
    NET:      new Set(['ASTRO', 'CEMENT', 'NATURAL']),
    SIDEARM:  new Set(['ASTRO', 'CEMENT', 'NATURAL']),
    COACHING: new Set(['ASTRO', 'CEMENT', 'NATURAL']),
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  // Load existing values. Fall back to all-three when the key is unset
  // or the stored JSON is malformed — same as the server-side resolver.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/admin/policies?scope=${scope}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        const arr: { key: string; value: string }[] = Array.isArray(data) ? data : (data.policies ?? []);
        const map: Record<string, string> = {};
        for (const row of arr) map[row.key] = row.value;
        if (cancelled) return;
        setSelections((prev) => {
          const next = { ...prev };
          for (const cat of CATEGORIES) {
            const raw = map[cat.policyKey];
            if (!raw) continue;
            try {
              const parsed = JSON.parse(raw);
              if (Array.isArray(parsed)) {
                const valid = parsed.filter((p): p is PitchKey =>
                  p === 'ASTRO' || p === 'CEMENT' || p === 'NATURAL'
                );
                if (valid.length > 0) next[cat.id] = new Set(valid);
              }
            } catch {
              // ignore malformed JSON — falls back to default 3-pitch set
            }
          }
          return next;
        });
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [scope]);

  useEffect(() => {
    if (externalSaveTrigger && externalSaveTrigger > 0) {
      saveAll();
    }
  }, [externalSaveTrigger]);

  useEffect(() => {
    onSaveStatus?.({ saving, message });
  }, [saving, message, onSaveStatus]);

  const saveAll = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const promises = CATEGORIES.map((cat) => {
        const enabled = Array.from(selections[cat.id]);
        if (enabled.length === 0) return Promise.resolve();

        return fetch(`/api/admin/policies?scope=${scope}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: cat.policyKey, value: JSON.stringify(enabled) }),
        });
      });

      const results = await Promise.all(promises);
      if (results.every((r) => !r || r.ok)) {
        setMessage({ text: 'Saved all pitch types', ok: true });
        setTimeout(() => setMessage(null), 3000);
      } else {
        setMessage({ text: 'Some updates failed', ok: false });
      }
    } catch {
      setMessage({ text: 'Failed to save', ok: false });
    } finally {
      setSaving(false);
    }
  };

  const togglePitch = (cat: CategoryKey, pitch: PitchKey) => {
    setSelections((prev) => {
      const next = { ...prev };
      const s = new Set(next[cat]);
      if (s.has(pitch)) s.delete(pitch);
      else s.add(pitch);
      next[cat] = s;
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-slate-400 py-4 justify-center text-xs">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-blue-500/5 border border-blue-500/10">
        <div className="mt-0.5">
          <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <p className="text-[11px] text-slate-400 leading-relaxed">
          Select which pitch types are available for each booking category.
          Disabling a pitch hides it from the user's selection for that category.
          <span className="block mt-1 text-slate-500 italic">Note: Machine pitch types are managed per-machine in the Machines tab.</span>
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {CATEGORIES.map((cat) => (
          <div
            key={cat.id}
            className="rounded-2xl bg-white/[0.02] border border-white/[0.06] p-3 flex flex-col gap-3 transition-all hover:bg-white/[0.04]"
          >
            <div className="flex flex-col gap-0.5">
              <div className="text-xs font-bold text-white tracking-tight">{cat.label}</div>
              <div className="text-[9px] text-slate-500 uppercase tracking-widest font-medium">{cat.sub}</div>
            </div>

            <div className="flex flex-col gap-1.5">
              {PITCHES.map((p) => {
                const on = selections[cat.id].has(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => togglePitch(cat.id, p.id)}
                    className={`group relative flex items-center justify-between px-3 py-2 rounded-xl text-[11px] font-semibold border transition-all cursor-pointer ${
                      on
                        ? 'bg-accent/10 text-accent border-accent/20 shadow-sm shadow-accent/5'
                        : 'bg-black/20 text-slate-500 border-white/[0.05] hover:border-white/[0.1] hover:text-slate-400'
                    }`}
                  >
                    <span>{p.label}</span>
                    <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center transition-all ${
                      on 
                        ? 'bg-accent border-accent text-primary' 
                        : 'border-white/10 bg-white/5'
                    }`}>
                      {on && (
                        <svg className="w-2 h-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={4} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {externalSaveTrigger === undefined && (
        <div className="flex items-center justify-between gap-3 pt-2 px-1">
          <div className="min-w-0">
            {message && (
              <div className={`flex items-center gap-1.5 text-[11px] font-medium animate-in fade-in slide-in-from-left-2 duration-300 ${message.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                <div className={`w-1.5 h-1.5 rounded-full ${message.ok ? 'bg-emerald-400' : 'bg-red-400'} animate-pulse`} />
                {message.text}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={saveAll}
            disabled={saving}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-accent text-primary text-xs font-bold hover:bg-accent-light active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-all shadow-lg shadow-accent/10"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Update All Categories
          </button>
        </div>
      )}
    </div>
  );
}
