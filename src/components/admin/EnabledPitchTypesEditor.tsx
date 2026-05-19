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

type CategoryKey = 'SIDEARM' | 'NET' | 'COACHING';
const CATEGORIES: Array<{
  id: CategoryKey;
  label: string;
  sub: string;
  policyKey: 'SIDEARM_PITCH_TYPES' | 'NET_PITCH_TYPES' | 'COACHING_PITCH_TYPES';
}> = [
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
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<CategoryKey | null>(null);
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

  const save = async (cat: CategoryKey) => {
    const enabled = Array.from(selections[cat]);
    if (enabled.length === 0) {
      // Refuse to save an empty list — the engine treats it the same
      // as "unset" anyway (falls back to all pitches), so the admin's
      // intent (hide every pitch) wouldn't actually take effect.
      setMessage({ text: `Pick at least one pitch for ${cat}`, ok: false });
      setTimeout(() => setMessage(null), 2500);
      return;
    }
    setSaving(cat);
    setMessage(null);
    const policyKey = CATEGORIES.find((c) => c.id === cat)!.policyKey;
    try {
      const res = await fetch(`/api/admin/policies?scope=${scope}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: policyKey, value: JSON.stringify(enabled) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      setMessage({ text: 'Saved', ok: true });
      setTimeout(() => setMessage(null), 2000);
    } catch (e) {
      setMessage({
        text: e instanceof Error ? `Failed: ${e.message}` : 'Failed to save',
        ok: false,
      });
    } finally {
      setSaving(null);
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
    <div className="space-y-3">
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
            className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-3"
          >
            <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-white">{cat.label}</div>
                <div className="text-[10px] text-slate-500">{cat.sub}</div>
              </div>
              <button
                type="button"
                onClick={() => save(cat.id)}
                disabled={saving !== null}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-accent/15 hover:bg-accent/25 text-accent border border-accent/30 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving === cat.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                Save
              </button>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {PITCHES.map((p) => {
                const on = selections[cat.id].has(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => togglePitch(cat.id, p.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer transition-colors ${
                      on
                        ? 'bg-accent/15 text-accent border-accent/30'
                        : 'bg-white/[0.04] text-slate-400 border-white/[0.08] hover:border-white/[0.16]'
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {message && (
        <p className={`text-[11px] font-medium ${message.ok ? 'text-emerald-400' : 'text-red-400'}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
