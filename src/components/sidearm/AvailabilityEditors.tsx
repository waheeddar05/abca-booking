'use client';

/**
 * Shared coach / sidearm availability UI.
 *
 * These pieces are used by BOTH:
 *   - Admin → Sidearm (`/admin/sidearm`) and Admin → Personal Coach
 *     (`/admin/coach`) — an admin manages every specialist at the center.
 *   - User Mode → Sidearm (`/sidearm`) and Personal Coach (`/coach`) —
 *     a specialist manages their own availability.
 *
 * Keeping the editor and the specialist card in one module guarantees
 * the surfaces render the *exact same* UI, fields, validations, and
 * workflow. The only difference is the API endpoint each one talks to,
 * which is passed in as a prop:
 *
 *   - Admin:  /api/admin/centers/[id]/members/[membershipId]/availability
 *   - User:   /api/sidearm/availability  •  /api/coach/availability
 *
 * Availability model: a Weekly schedule (one or more weekday + time
 * windows) PLUS an optional Effective Date Range. The weekly schedule
 * only applies to dates inside that range. The old, separate "Date Range
 * Availability" feature has been removed — weekly + effective range is
 * now the single way to manage availability.
 */

import { useState, type ReactNode } from 'react';
import { Loader2, CalendarClock, CalendarRange, Save, Plus, Trash2, Pencil, Mail, Phone } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

export type WeeklyWindowRow = {
  id: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  // Effective date range (ISO date strings). Schedule-level, so every
  // row of a given specialist carries the same value. Null = unbounded.
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
};

export type Specialist = {
  id: string;
  priority: number;
  user: { id: string; name: string | null; email: string | null; mobileNumber: string | null };
  availability: WeeklyWindowRow[];
};

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ─── Availability summary helpers ───────────────────────────────────────
// These let a listing show a specialist's schedule at a glance, so the
// viewer doesn't have to open the editor to understand availability.

/** "17:00" -> "5:00 PM". Falls back to the raw value if unparseable. */
export function formatTime(t: string | null | undefined): string {
  if (!t) return '';
  const [hStr, mStr] = t.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return t;
  const period = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, '0')} ${period}`;
}

/** ISO date -> "10 Jun 2026" in IST. */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Human-readable effective range, e.g. "01 Jan 2026 – 31 Dec 2026",
 *  "From 01 Jan 2026", "Until 31 Dec 2026", or "No date limit". */
export function formatEffectiveRange(
  from: string | null | undefined,
  to: string | null | undefined,
): string {
  if (from && to) return `${formatDate(from)} – ${formatDate(to)}`;
  if (from) return `From ${formatDate(from)}`;
  if (to) return `Until ${formatDate(to)}`;
  return 'No date limit';
}

/** Collapse a list of weekday numbers (0=Sun..6=Sat) into runs, e.g.
 *  [1,2,3,4,5] -> "Mon–Fri", [1,3,5] -> "Mon, Wed, Fri". */
export function formatDayList(days: number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  const runs: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    runs.push(j > i ? `${DAY_LABELS[sorted[i]]}–${DAY_LABELS[sorted[j]]}` : DAY_LABELS[sorted[i]]);
    i = j + 1;
  }
  return runs.join(', ');
}

/** Group weekly windows that share the same time span so the summary
 *  reads "Mon–Fri · 5:00 PM – 9:00 PM" instead of one line per day. */
export function summarizeWeekly(
  availability: Array<{ dayOfWeek: number; startTime: string; endTime: string }>,
): Array<{ days: number[]; start: string; end: string }> {
  const byWindow = new Map<string, number[]>();
  for (const w of availability) {
    const key = `${w.startTime}-${w.endTime}`;
    const arr = byWindow.get(key);
    if (arr) arr.push(w.dayOfWeek);
    else byWindow.set(key, [w.dayOfWeek]);
  }
  return [...byWindow.entries()]
    .map(([key, days]) => {
      const [start, end] = key.split('-');
      return { days, start, end };
    })
    // Sort by the earliest day in each window for a stable, readable order.
    .sort((a, b) => Math.min(...a.days) - Math.min(...b.days));
}

// ─── Specialist availability card ───────────────────────────────────────
// Renders one specialist's identity, status, weekly summary (with its
// effective period), and the inline weekly editor. Used by both the admin
// list (with priority controls passed via `leading`) and the user's
// own-availability page.

export function SpecialistAvailabilityCard({
  specialist: s,
  weeklyEndpoint,
  onChanged,
  leading,
}: {
  specialist: Specialist;
  /** Base URL for weekly availability GET/PUT (preview via ?preview=true). */
  weeklyEndpoint: string;
  /** Called after a successful save so the parent can refetch summaries. */
  onChanged: () => void;
  /** Optional leading column (e.g. admin priority up/down arrows). */
  leading?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const hasAvailability = s.availability.length > 0;
  const effFrom = s.availability[0]?.effectiveFrom ?? null;
  const effTo = s.availability[0]?.effectiveTo ?? null;

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="flex items-start gap-3 flex-wrap">
        {leading}

        <div className="min-w-0 flex-1 space-y-2.5">
          {/* Identity + status */}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-white truncate">
                  {s.user.name || '(no name)'}
                </span>
                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                  hasAvailability ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'
                }`}>
                  {hasAvailability ? 'Active' : 'No availability'}
                </span>
              </div>
              {/* Contact info */}
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                {s.user.email && (
                  <span className="inline-flex items-center gap-1 min-w-0">
                    <Mail className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate">{s.user.email}</span>
                  </span>
                )}
                {s.user.mobileNumber && (
                  <span className="inline-flex items-center gap-1">
                    <Phone className="w-3 h-3 flex-shrink-0" />
                    {s.user.mobileNumber}
                  </span>
                )}
                {!s.user.email && !s.user.mobileNumber && (
                  <span className="truncate">{s.user.id}</span>
                )}
              </div>
            </div>
          </div>

          {/* Weekly availability summary — visible without opening the editor. */}
          <div>
            <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
              <CalendarClock className="w-3 h-3" /> Weekly availability
            </div>
            {s.availability.length === 0 ? (
              <p className="text-[11px] text-slate-600 italic">Not configured</p>
            ) : (
              <div className="space-y-1">
                {/* Effective period chip */}
                <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-accent/10 text-accent text-[10px] font-medium">
                  <CalendarRange className="w-3 h-3" />
                  {formatEffectiveRange(effFrom, effTo)}
                </div>
                <div className="space-y-0.5">
                  {summarizeWeekly(s.availability).map((w, wi) => (
                    <div key={wi} className="text-[11px] text-slate-300">
                      <span className="font-medium text-slate-200">{formatDayList(w.days)}</span>
                      <span className="text-slate-500"> · </span>
                      {formatTime(w.start)} – {formatTime(w.end)}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Edit action */}
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border cursor-pointer ${
                editing
                  ? 'bg-accent/15 text-accent border-accent/30'
                  : 'bg-white/[0.04] text-slate-300 border-white/[0.08] hover:bg-white/[0.08]'
              }`}
            >
              <Pencil className="w-3 h-3" />
              {editing ? 'Close editor' : 'Edit availability'}
            </button>
          </div>
        </div>
      </div>

      {editing && (
        <div className="mt-3 pt-3 border-t border-white/[0.05]">
          <WeeklyAvailabilityEditor
            endpoint={weeklyEndpoint}
            initial={s.availability}
            onSaved={() => { setEditing(false); onChanged(); }}
            onCancel={() => setEditing(false)}
          />
        </div>
      )}
    </div>
  );
}

// ─── Weekly availability editor (with effective date range) ─────────────

interface RecurringWindow {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export function WeeklyAvailabilityEditor({
  endpoint,
  initial,
  onSaved,
  onCancel,
}: {
  /** Base URL — PUT here, preview via `${endpoint}?preview=true`. */
  endpoint: string;
  initial: WeeklyWindowRow[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [effectiveFrom, setEffectiveFrom] = useState<string>(
    () => (initial[0]?.effectiveFrom ? initial[0].effectiveFrom.slice(0, 10) : ''),
  );
  const [effectiveTo, setEffectiveTo] = useState<string>(
    () => (initial[0]?.effectiveTo ? initial[0].effectiveTo.slice(0, 10) : ''),
  );
  const [windows, setWindows] = useState<RecurringWindow[]>(
    () => initial.map((w) => ({ dayOfWeek: w.dayOfWeek, startTime: w.startTime, endTime: w.endTime })),
  );
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [impactedCount, setImpactedCount] = useState<number | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingDeleteIdx, setPendingDeleteIdx] = useState<number | null>(null);

  const add = () => setWindows((prev) => [...prev, { dayOfWeek: 1, startTime: '06:00', endTime: '09:00' }]);
  const remove = (i: number) => {
    setWindows((prev) => prev.filter((_, idx) => idx !== i));
    setPendingDeleteIdx(null);
  };
  const update = (i: number, patch: Partial<RecurringWindow>) =>
    setWindows((prev) => prev.map((w, idx) => (idx === i ? { ...w, ...patch } : w)));

  const dateRangeInvalid = Boolean(effectiveFrom && effectiveTo && effectiveTo < effectiveFrom);

  const payload = () => ({
    effectiveFrom: effectiveFrom || null,
    effectiveTo: effectiveTo || null,
    windows,
  });

  const save = async (bypassConfirm = false) => {
    if (dateRangeInvalid) {
      setMsg({ text: 'End date must be on or after start date', ok: false });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      if (!bypassConfirm) {
        // Preview first
        const r = await fetch(`${endpoint}?preview=true`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload()),
        });
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body?.error || `HTTP ${r.status}`);

        if (body.impactedCount > 0) {
          setImpactedCount(body.impactedCount);
          setShowConfirm(true);
          setSaving(false);
          return;
        }
      }

      // Proceed with actual save
      const r = await fetch(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload()),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body?.error || `HTTP ${r.status}`);
      setMsg({ text: 'Saved', ok: true });
      setTimeout(onSaved, 600);
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : 'Failed to save', ok: false });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <ConfirmDialog
        open={showConfirm}
        title="Impacted Bookings"
        message={`Changing the availability will result in ${impactedCount} existing booking(s) being cancelled and refunded to user wallets.`}
        warning="This action cannot be undone. Impacted users will be notified automatically."
        confirmLabel="Proceed & Cancel Bookings"
        cancelLabel="Review Changes"
        variant="danger"
        loading={saving}
        onConfirm={() => {
          setShowConfirm(false);
          save(true);
        }}
        onCancel={() => {
          setShowConfirm(false);
          setImpactedCount(null);
        }}
      />

      <ConfirmDialog
        open={pendingDeleteIdx !== null}
        title="Delete Window"
        message="Are you sure you want to delete this availability window? This might impact existing bookings when you save."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => {
          if (pendingDeleteIdx !== null) remove(pendingDeleteIdx);
        }}
        onCancel={() => setPendingDeleteIdx(null)}
      />

      {/* ── Effective date range ─────────────────────────────────────── */}
      <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 space-y-2">
        <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          <CalendarRange className="w-3 h-3" /> Effective date range
        </div>
        <p className="text-[11px] text-slate-500 leading-relaxed">
          The weekly schedule below only applies between these dates. Leave a
          field empty for no limit on that side.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="block">
            <span className="text-[10px] text-slate-500 uppercase tracking-wide">Start date</span>
            <input
              type="date"
              value={effectiveFrom}
              max={effectiveTo || undefined}
              onChange={(e) => setEffectiveFrom(e.target.value)}
              className="mt-1 w-full bg-white/[0.04] border border-white/[0.1] text-white rounded-lg px-3 py-2.5 text-base leading-tight tabular-nums outline-none focus:border-accent [color-scheme:dark]"
            />
          </label>
          <label className="block">
            <span className="text-[10px] text-slate-500 uppercase tracking-wide">End date</span>
            <input
              type="date"
              value={effectiveTo}
              min={effectiveFrom || undefined}
              onChange={(e) => setEffectiveTo(e.target.value)}
              className="mt-1 w-full bg-white/[0.04] border border-white/[0.1] text-white rounded-lg px-3 py-2.5 text-base leading-tight tabular-nums outline-none focus:border-accent [color-scheme:dark]"
            />
          </label>
        </div>
        {dateRangeInvalid && (
          <p className="text-[11px] text-red-400">End date must be on or after start date.</p>
        )}
      </div>

      {/* ── Weekly schedule ──────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          <CalendarClock className="w-3 h-3" /> Weekly schedule
        </div>
        <p className="text-[11px] text-slate-500 leading-relaxed">
          Add a window for each weekday you&apos;re available. Days with no
          window are treated as <span className="text-slate-400">Not Available</span>.
          Multiple windows on the same day stack as a union (e.g. 09:00–12:00 +
          17:00–21:00).
        </p>
        {windows.length === 0 ? (
          <p className="text-[11px] text-slate-600 italic py-2">
            No windows configured. This specialist is treated as unavailable
            on every day until you add a window.
          </p>
        ) : (
          <div className="space-y-1.5">
            {windows.map((w, i) => (
              <div
                key={i}
                className="flex flex-wrap items-center gap-2 rounded-lg bg-white/[0.02] border border-white/[0.05] p-2"
              >
                <select
                  value={w.dayOfWeek}
                  onChange={(e) => update(i, { dayOfWeek: Number(e.target.value) })}
                  className="w-[5.5rem] shrink-0 bg-white/[0.04] border border-white/[0.1] text-white rounded-lg px-2.5 py-2.5 text-base leading-tight outline-none focus:border-accent"
                >
                  {DAY_LABELS.map((d, idx) => (
                    <option key={idx} value={idx}>{d}</option>
                  ))}
                </select>
                {/* Times share a flex group with a min-width so they keep room
                    for the full "HH:MM AM" value; on a narrow screen the group
                    wraps to its own line instead of squeezing the text. The
                    16px (text-base) font keeps each value legible and stops
                    iOS Safari from auto-zooming the page when the field is
                    focused for editing. */}
                <div className="order-last w-full sm:order-none sm:w-auto flex flex-1 min-w-[12rem] items-center gap-2">
                  <input
                    type="time"
                    value={w.startTime}
                    onChange={(e) => update(i, { startTime: e.target.value })}
                    className="min-w-0 flex-1 bg-white/[0.04] border border-white/[0.1] text-white rounded-lg px-2.5 py-2.5 text-base leading-tight tabular-nums outline-none focus:border-accent [color-scheme:dark]"
                  />
                  <span className="text-slate-500 text-xs shrink-0">–</span>
                  <input
                    type="time"
                    value={w.endTime}
                    onChange={(e) => update(i, { endTime: e.target.value })}
                    className="min-w-0 flex-1 bg-white/[0.04] border border-white/[0.1] text-white rounded-lg px-2.5 py-2.5 text-base leading-tight tabular-nums outline-none focus:border-accent [color-scheme:dark]"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setPendingDeleteIdx(i)}
                  className="ml-auto p-2 rounded-lg text-red-400/70 hover:bg-red-500/10 hover:text-red-400 cursor-pointer shrink-0"
                  title="Delete Window"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={add}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-slate-300 bg-white/[0.04] hover:bg-white/[0.08] cursor-pointer"
        >
          <Plus className="w-3 h-3" /> Add window
        </button>
      </div>

      {/* ── Actions ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-end gap-2 pt-1.5 border-t border-white/[0.05]">
        {msg && (
          <span className={`text-xs font-medium mr-auto ${msg.ok ? 'text-emerald-400' : 'text-red-400'}`}>
            {msg.text}
          </span>
        )}
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="px-3 py-2 rounded-lg text-xs text-slate-300 bg-white/[0.04] hover:bg-white/[0.08] cursor-pointer disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => save()}
          disabled={saving || dateRangeInvalid}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-black text-xs font-semibold hover:bg-accent/90 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
        >
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
          Save
        </button>
      </div>
    </div>
  );
}
