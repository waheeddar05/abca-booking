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
  externalSaveTrigger,
  onSaveStatus,
}: {
  scope: 'center' | 'global';
  centerLabel: string;
  externalSaveTrigger?: number;
  onSaveStatus?: (status: { saving: boolean; message: { text: string; ok: boolean } | null }) => void;
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

  useEffect(() => {
    if (externalSaveTrigger && externalSaveTrigger > 0) {
      save();
    }
  }, [externalSaveTrigger]);

  useEffect(() => {
    onSaveStatus?.({ saving, message });
  }, [saving, message, onSaveStatus]);

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

      {/* Selection tiles match the "Pitch Types Per Category" control
          (label + circular check indicator) so every selectable option
          across Settings uses one consistent, readable pattern instead of
          a mix of native checkboxes and boxes. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {ALL_CATEGORIES.map((c) => {
          const on = enabled.has(c.id);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => toggle(c.id)}
              className={`group relative flex flex-col gap-1 px-3 py-2.5 rounded-xl text-left border transition-all cursor-pointer ${
                on
                  ? 'bg-accent/10 text-accent border-accent/20 shadow-sm shadow-accent/5'
                  : 'bg-black/20 text-slate-500 border-white/[0.05] hover:border-white/[0.1] hover:text-slate-400'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`text-xs font-semibold ${on ? 'text-white' : 'text-slate-400'}`}>{c.label}</span>
                <div className={`w-3.5 h-3.5 flex-shrink-0 rounded-full border flex items-center justify-center transition-all ${
                  on ? 'bg-accent border-accent text-primary' : 'border-white/10 bg-white/5'
                }`}>
                  {on && (
                    <svg className="w-2 h-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={4} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
              </div>
              <div className="text-[9px] text-slate-500 uppercase tracking-tight">{c.sub}</div>
            </button>
          );
        })}
      </div>

      {!externalSaveTrigger && (
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
