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

type CategoryKey = 'SIDEARM' | 'NET' | 'COACHING' | 'MACHINE';
const CATEGORIES: Array<{
  id: CategoryKey;
  label: string;
  sub: string;
  policyKey: 'SIDEARM_PITCH_TYPES' | 'NET_PITCH_TYPES' | 'COACHING_PITCH_TYPES' | 'MACHINE_PITCH_TYPES';
}> = [
  { id: 'MACHINE',  label: 'Bowling Machine',   sub: 'Gravity/Yantra/Leverage', policyKey: 'MACHINE_PITCH_TYPES' },
  { id: 'NET',      label: 'Cricket Nets',      sub: 'Bare-net practice',  policyKey: 'NET_PITCH_TYPES' },
  { id: 'SIDEARM',  label: 'Sidearm',           sub: 'Bowled by a specialist', policyKey: 'SIDEARM_PITCH_TYPES' },
  { id: 'COACHING', label: 'Personal Coaching', sub: 'With a coach',        policyKey: 'COACHING_PITCH_TYPES' },
];

export function EnabledPitchTypesEditor({
  scope,
}: {
  scope: 'center' | 'global';
}) {
  // selections[category] is the set of pitches enabled. Empty set = "no
  // pitches at all" — we treat that as falling back to every pitch,
  // same as the engine policy default, so admins can't accidentally
  // remove every option.
  const [selections, setSelections] = useState<Record<CategoryKey, Set<PitchKey>>>({
    NET:      new Set(['ASTRO', 'CEMENT', 'NATURAL']),
    SIDEARM:  new Set(['ASTRO', 'CEMENT', 'NATURAL']),
    COACHING: new Set(['ASTRO', 'CEMENT', 'NATURAL']),
    MACHINE:  new Set(['ASTRO', 'CEMENT', 'NATURAL']),
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
      <p className="text-[11px] text-slate-500 leading-relaxed">
        Pick which pitch types are offered in each booking flow. Disabling Cement
        here, for example, hides the Cement chip from the Cricket Nets pitch
        picker on the user side. At least one pitch must stay enabled per
        category — clearing all three falls back to the default 3-pitch set.
      </p>

      <div className="space-y-2">
        {CATEGORIES.map((cat) => (
          <div
            key={cat.id}
            className="rounded-xl bg-white/[0.03] border border-white/[0.08] p-3.5 flex items-center justify-between gap-4"
          >
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white">{cat.label}</div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">{cat.sub}</div>
            </div>
            <div className="flex gap-1.5 flex-shrink-0">
              {PITCHES.map((p) => {
                const on = selections[cat.id].has(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => togglePitch(cat.id, p.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider border cursor-pointer transition-all ${
                      on
                        ? 'bg-accent text-primary border-accent shadow-sm'
                        : 'bg-white/[0.04] text-slate-500 border-white/[0.08] hover:border-white/[0.16]'
                    }`}
                  >
                    {p.id}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-end gap-3 pt-2">
        {message && (
          <p className={`text-[11px] font-medium ${message.ok ? 'text-emerald-400' : 'text-red-400'}`}>
            {message.text}
          </p>
        )}
        <button
          type="button"
          onClick={saveAll}
          disabled={saving}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-black text-xs font-bold hover:bg-accent/90 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer transition-all"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Save Pitch Types
        </button>
      </div>
    </div>
  );
}
