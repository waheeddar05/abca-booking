'use client';

import { useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';

/**
 * Per-center toggles for which booking categories appear in the user
 * slot picker. Persists to `ENABLED_BOOKING_CATEGORIES` policy via the
 * scope-aware admin policies API. Empty list is impossible — at least
 * one category must remain on, otherwise users have nothing to book.
 */

type CategoryId =
  | 'MACHINE'
  | 'NET'
  | 'SIDEARM'
  | 'COACHING'
  // CORPORATE_BATCH stays in the DB enum but is intentionally
  // omitted from the admin-editable list — it's been hidden from
  // every user-facing surface.
  | 'FULL_COURT';

const ALL_CATEGORIES: Array<{ id: CategoryId; label: string; sub: string }> = [
  { id: 'MACHINE',         label: 'Bowling Machine',      sub: 'Yantra / Leverage' },
  { id: 'NET',             label: 'Cricket Nets',         sub: 'Bare net for self practice' },
  { id: 'SIDEARM',         label: 'Sidearm',              sub: 'Bowled by staff' },
  { id: 'COACHING',        label: 'Personal Coaching',    sub: 'With a coach' },
  { id: 'FULL_COURT',      label: 'Full Indoor Court',    sub: 'All indoor nets' },
];

export function EnabledCategoriesEditor({
  scope,
  centerLabel,
}: {
  scope: 'center' | 'global';
  centerLabel: string;
}) {
  const [enabled, setEnabled] = useState<Set<CategoryId>>(
    () => new Set(ALL_CATEGORIES.map((c) => c.id)),
  );
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
        const row = rows.find((r) => r.key === 'ENABLED_BOOKING_CATEGORIES');
        if (cancelled) return;
        if (row) {
          try {
            const list = JSON.parse(row.value) as CategoryId[];
            if (Array.isArray(list) && list.length > 0) {
              setEnabled(new Set(list));
              return;
            }
          } catch { /* fall through to default */ }
        }
        setEnabled(new Set(ALL_CATEGORIES.map((c) => c.id)));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [scope]);

  const toggle = (id: CategoryId) => {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        if (next.size === 1) return prev; // never go to zero
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      // Persist in the canonical order so the slot UI reads them in a
      // stable arrangement regardless of click order on this form.
      const value = ALL_CATEGORIES.filter((c) => enabled.has(c.id)).map((c) => c.id);
      const res = await fetch(`/api/admin/policies?scope=${scope}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: 'ENABLED_BOOKING_CATEGORIES',
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
        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-[11px] text-slate-500 leading-relaxed">
        Hidden categories don&apos;t appear in the user-facing slot picker
        for {centerLabel}. At least one must stay on.
      </div>

      <div className="grid sm:grid-cols-2 gap-2">
        {ALL_CATEGORIES.map((c) => {
          const on = enabled.has(c.id);
          return (
            <label
              key={c.id}
              className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                on
                  ? 'bg-accent/[0.06] border-accent/30'
                  : 'bg-white/[0.02] border-white/[0.06] hover:border-white/[0.12]'
              }`}
            >
              <input
                type="checkbox"
                checked={on}
                onChange={() => toggle(c.id)}
                className="mt-0.5 w-4 h-4 accent-accent cursor-pointer"
              />
              <div className="min-w-0">
                <div className={`text-sm font-semibold ${on ? 'text-white' : 'text-slate-400'}`}>
                  {c.label}
                </div>
                <div className="text-[11px] text-slate-500">{c.sub}</div>
              </div>
            </label>
          );
        })}
      </div>

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
    </div>
  );
}
