'use client';

/**
 * Admin → Sidearm tab.
 *
 * Lists every SIDEARM_SPECIALIST membership at the current center.
 * Lets the admin:
 *   - Reorder priority (1 = first pick by `pickStaffFor`)
 *   - Edit recurring weekly availability (reuses the existing PUT
 *     /availability endpoint)
 *   - Edit date-range availability (new PUT /date-availability)
 *
 * Resource-based centers only. The sidebar link is gated on
 * bookingModel='RESOURCE_BASED' so ABCA admins don't see this page;
 * if they manage to navigate here directly, the loader returns an
 * empty list (ABCA never has SIDEARM_SPECIALIST memberships).
 */

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useCenter } from '@/lib/center-context';
import { Loader2, ArrowUp, ArrowDown, CalendarClock, CalendarRange, Save, Plus, Trash2, Users } from 'lucide-react';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

type Specialist = {
  id: string;
  priority: number;
  user: { id: string; name: string | null; email: string | null; mobileNumber: string | null };
  availability: Array<{ id: string; dayOfWeek: number; startTime: string; endTime: string }>;
  dateAvailability: Array<{
    id: string;
    fromDate: string;
    toDate: string;
    startTime: string | null;
    endTime: string | null;
    label: string | null;
  }>;
};

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function AdminSidearmPage() {
  const { data: session } = useSession();
  const { currentCenter, loading: centerLoading } = useCenter();
  const [specialists, setSpecialists] = useState<Specialist[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingPriorityId, setSavingPriorityId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDateId, setEditingDateId] = useState<string | null>(null);

  const refresh = async () => {
    if (!currentCenter) return;
    setLoading(true);
    setError(null);
    try {
      const userRole = (session?.user as any)?.role;
      const isSidearmSpecialist = userRole === 'SIDEARM_SPECIALIST';
      const userId = (session?.user as any)?.id;

      const r = await fetch(
        `/api/admin/centers/${currentCenter.id}/members?role=SIDEARM_SPECIALIST`,
      );
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${r.status}`);
      }
      let list = (await r.json()) as Specialist[];

      // If the user is just a sidearm specialist (not an admin), only show
      // their own row. They can edit their own availability but shouldn't
      // see or reorder others.
      if (isSidearmSpecialist && userId) {
        list = list.filter((s) => s.user.id === userId);
      }

      setSpecialists(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load specialists');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (centerLoading) return;
    if (!currentCenter) {
      setLoading(false);
      return;
    }
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerLoading, currentCenter?.id]);

  /**
   * Swap priorities with the neighbour in `direction`. PATCH both
   * memberships so the ordering persists; the GET response is sorted
   * by priority, so the UI updates on next refresh.
   *
   * We send the values explicitly rather than "increment / decrement"
   * to avoid races where two admins reorder at once (last write wins
   * on the explicit value, which is fine — both targets are intentional).
   */
  const move = async (idx: number, direction: 'up' | 'down') => {
    if (!currentCenter) return;
    const otherIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (otherIdx < 0 || otherIdx >= specialists.length) return;
    const a = specialists[idx];
    const b = specialists[otherIdx];

    // Use sequential integers so the list stays cleanly numbered.
    // Re-index from 1 over the entire list so a stretched legacy
    // priority (e.g. 100, 100, 100) collapses to 1..N on first move.
    const reindexed = specialists.map((s, i) => ({
      ...s,
      priority: i === idx ? otherIdx + 1 : i === otherIdx ? idx + 1 : i + 1,
    }));
    // Swap the two rows in display order so the ArrowUp on the row
    // visually moves it up immediately, before the save round-trips.
    [reindexed[idx], reindexed[otherIdx]] = [reindexed[otherIdx], reindexed[idx]];
    setSpecialists(reindexed);

    setSavingPriorityId(a.id);
    try {
      // Persist both. We don't need to PATCH the rows whose priority
      // didn't actually change, but keeping the full re-index makes
      // the eventual DB state predictable regardless of how the user
      // reorders.
      await Promise.all(
        reindexed.map((s) =>
          fetch(
            `/api/admin/centers/${currentCenter.id}/members/${s.id}`,
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ priority: s.priority }),
            },
          ),
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save priority');
    } finally {
      setSavingPriorityId(null);
      void b;
    }
  };

  if (centerLoading || loading) {
    return (
      <div className="flex items-center gap-2 text-slate-400 py-10 justify-center text-sm">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
      </div>
    );
  }

  if (!currentCenter) {
    return <p className="text-sm text-slate-400">Select a center first.</p>;
  }

  if (currentCenter.bookingModel !== 'RESOURCE_BASED') {
    return (
      <div className="space-y-3">
        <AdminPageHeader
          icon={Users}
          title="Sidearm"
          description="Manage sidearm specialists, availability, and priority order."
        />
        <p className="text-sm text-slate-400">
          Sidearm management is only available for resource-based centers.
          {currentCenter.shortName ?? currentCenter.name} uses the legacy
          machine/pitch model — sidearm bookings aren&apos;t exposed there.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <AdminPageHeader
        icon={Users}
        title="Sidearm"
        description="Specialists who appear on the Sidearm booking flow. Priority drives auto-assignment when the user doesn't pin a specialist; availability filters which slots they show up for."
      />

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/[0.05] px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {specialists.length === 0 ? (
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-6 text-center text-sm text-slate-400">
          No sidearm specialists at this center yet.
          <br />
          Add one via{' '}
          <a
            href={`/admin/centers/${currentCenter.id}`}
            className="text-accent underline hover:no-underline"
          >
            Center → Members
          </a>
          {' '}with role &ldquo;Sidearm Specialist&rdquo;.
        </div>
      ) : (
        <div className="space-y-3">
          {specialists.map((s, idx) => (
            <div
              key={s.id}
              className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3"
            >
              <div className="flex items-start gap-3 flex-wrap">
                {/* Priority controls — up / down arrows. Disabled at the
                    ends. */}
                <div className="flex flex-col gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => move(idx, 'up')}
                    disabled={idx === 0 || savingPriorityId !== null}
                    className="p-1 rounded text-slate-400 bg-white/[0.04] hover:bg-white/[0.08] disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                    title="Move up in priority"
                  >
                    <ArrowUp className="w-3 h-3" />
                  </button>
                  <span className="text-[10px] text-slate-500 text-center font-mono">
                    {savingPriorityId === s.id ? '…' : idx + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => move(idx, 'down')}
                    disabled={idx === specialists.length - 1 || savingPriorityId !== null}
                    className="p-1 rounded text-slate-400 bg-white/[0.04] hover:bg-white/[0.08] disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                    title="Move down in priority"
                  >
                    <ArrowDown className="w-3 h-3" />
                  </button>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-white truncate">
                    {s.user.name || '(no name)'}
                  </div>
                  <div className="text-[11px] text-slate-500 truncate">
                    {s.user.email || s.user.mobileNumber || s.user.id}
                  </div>
                  {/* Availability summaries — collapsed in the row, expand
                      to edit by clicking the chip's pencil icon. */}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => { setEditingId(editingId === s.id ? null : s.id); setEditingDateId(null); }}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border cursor-pointer ${
                        editingId === s.id
                          ? 'bg-accent/15 text-accent border-accent/30'
                          : 'bg-white/[0.04] text-slate-300 border-white/[0.08] hover:bg-white/[0.08]'
                      }`}
                    >
                      <CalendarClock className="w-3 h-3" />
                      {s.availability.length > 0 ? `Weekly schedule (${s.availability.length})` : 'Weekly schedule — empty'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setEditingDateId(editingDateId === s.id ? null : s.id); setEditingId(null); }}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border cursor-pointer ${
                        editingDateId === s.id
                          ? 'bg-accent/15 text-accent border-accent/30'
                          : 'bg-white/[0.04] text-slate-300 border-white/[0.08] hover:bg-white/[0.08]'
                      }`}
                    >
                      <CalendarRange className="w-3 h-3" />
                      {s.dateAvailability.length > 0 ? `Date ranges (${s.dateAvailability.length})` : 'Date ranges — none'}
                    </button>
                  </div>
                </div>
              </div>

              {editingId === s.id && (
                <div className="mt-3 pt-3 border-t border-white/[0.05]">
                  <RecurringAvailabilityEditor
                    centerId={currentCenter.id}
                    membershipId={s.id}
                    initial={s.availability}
                    onSaved={() => { setEditingId(null); refresh(); }}
                    onCancel={() => setEditingId(null)}
                  />
                </div>
              )}

              {editingDateId === s.id && (
                <div className="mt-3 pt-3 border-t border-white/[0.05]">
                  <DateAvailabilityEditor
                    centerId={currentCenter.id}
                    membershipId={s.id}
                    initial={s.dateAvailability}
                    onSaved={() => { setEditingDateId(null); refresh(); }}
                    onCancel={() => setEditingDateId(null)}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Recurring (weekly) availability editor ─────────────────────────────

interface RecurringWindow {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

function RecurringAvailabilityEditor({
  centerId,
  membershipId,
  initial,
  onSaved,
  onCancel,
}: {
  centerId: string;
  membershipId: string;
  initial: Array<{ id: string; dayOfWeek: number; startTime: string; endTime: string }>;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [windows, setWindows] = useState<RecurringWindow[]>(
    () => initial.map((w) => ({ dayOfWeek: w.dayOfWeek, startTime: w.startTime, endTime: w.endTime })),
  );
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [impactedCount, setImpactedCount] = useState<number | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingDeleteIdx, setPendingDeleteIdx] = useState<number | null>(null);

  const add = () => setWindows((prev) => [...prev, { dayOfWeek: 1, startTime: '17:00', endTime: '21:00' }]);
  const remove = (i: number) => {
    setWindows((prev) => prev.filter((_, idx) => idx !== i));
    setPendingDeleteIdx(null);
  };
  const update = (i: number, patch: Partial<RecurringWindow>) =>
    setWindows((prev) => prev.map((w, idx) => (idx === i ? { ...w, ...patch } : w)));

  const save = async (bypassConfirm = false) => {
    setSaving(true);
    setMsg(null);
    try {
      if (!bypassConfirm) {
        // Preview first
        const r = await fetch(
          `/api/admin/centers/${centerId}/members/${membershipId}/availability?preview=true`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ windows }),
          },
        );
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
      const r = await fetch(
        `/api/admin/centers/${centerId}/members/${membershipId}/availability`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ windows }),
        },
      );
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
    <div className="space-y-2">
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

      <p className="text-[11px] text-slate-500 leading-relaxed">
        Weekly recurring windows. Empty list = unavailable by default. Multiple
        rows on the same day stack as a union (e.g. 09:00–12:00 +
        17:00–21:00).
      </p>
      {windows.length === 0 ? (
        <p className="text-[11px] text-slate-600 italic py-2">
          No recurring windows configured. This specialist is treated as
          unavailable unless a date range below adds availability.
        </p>
      ) : (
        <div className="space-y-1.5 overflow-x-auto pb-1">
          {windows.map((w, i) => (
            <div key={i} className="flex flex-wrap sm:grid sm:grid-cols-[1fr_auto_auto_auto] gap-2 items-center min-w-[300px]">
              <select
                value={w.dayOfWeek}
                onChange={(e) => update(i, { dayOfWeek: Number(e.target.value) })}
                className="bg-white/[0.04] border border-white/[0.1] text-white rounded-lg px-2 py-1.5 text-xs outline-none focus:border-accent flex-1 sm:flex-none"
              >
                {DAY_LABELS.map((d, idx) => (
                  <option key={idx} value={idx}>{d}</option>
                ))}
              </select>
              <input
                type="time"
                value={w.startTime}
                onChange={(e) => update(i, { startTime: e.target.value })}
                className="bg-white/[0.04] border border-white/[0.1] text-white rounded-lg px-2 py-1.5 text-xs outline-none focus:border-accent [color-scheme:dark] flex-1 sm:flex-none"
              />
              <input
                type="time"
                value={w.endTime}
                onChange={(e) => update(i, { endTime: e.target.value })}
                className="bg-white/[0.04] border border-white/[0.1] text-white rounded-lg px-2 py-1.5 text-xs outline-none focus:border-accent [color-scheme:dark] flex-1 sm:flex-none"
              />
              <button
                type="button"
                onClick={() => setPendingDeleteIdx(i)}
                className="p-1.5 rounded-lg text-red-400/70 hover:bg-red-500/10 hover:text-red-400 cursor-pointer"
                title="Delete Window"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between gap-2 pt-1.5">
        <button
          type="button"
          onClick={add}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-slate-300 bg-white/[0.04] hover:bg-white/[0.08] cursor-pointer"
        >
          <Plus className="w-3 h-3" /> Add window
        </button>
        <div className="flex items-center gap-2">
          {msg && (
            <span className={`text-xs font-medium ${msg.ok ? 'text-emerald-400' : 'text-red-400'}`}>
              {msg.text}
            </span>
          )}
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="px-2.5 py-1.5 rounded-lg text-xs text-slate-300 bg-white/[0.04] hover:bg-white/[0.08] cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-black text-xs font-semibold hover:bg-accent/90 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Date-range availability editor ─────────────────────────────────────

interface DateWindow {
  fromDate: string;
  toDate: string;
  startTime: string;
  endTime: string;
  label: string;
}

function DateAvailabilityEditor({
  centerId,
  membershipId,
  initial,
  onSaved,
  onCancel,
}: {
  centerId: string;
  membershipId: string;
  initial: Array<{ id: string; fromDate: string; toDate: string; startTime: string | null; endTime: string | null; label: string | null }>;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [windows, setWindows] = useState<DateWindow[]>(
    () => initial.map((w) => ({
      fromDate: w.fromDate.slice(0, 10),
      toDate: w.toDate.slice(0, 10),
      startTime: w.startTime || '',
      endTime: w.endTime || '',
      label: w.label || '',
    })),
  );
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [impactedCount, setImpactedCount] = useState<number | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingDeleteIdx, setPendingDeleteIdx] = useState<number | null>(null);

  const add = () => {
    const today = new Date().toISOString().slice(0, 10);
    setWindows((prev) => [...prev, { fromDate: today, toDate: today, startTime: '', endTime: '', label: '' }]);
  };
  const remove = (i: number) => {
    setWindows((prev) => prev.filter((_, idx) => idx !== i));
    setPendingDeleteIdx(null);
  };
  const update = (i: number, patch: Partial<DateWindow>) =>
    setWindows((prev) => prev.map((w, idx) => (idx === i ? { ...w, ...patch } : w)));

  const save = async (bypassConfirm = false) => {
    setSaving(true);
    setMsg(null);
    try {
      // Strip empty optional fields so the server doesn't reject the
      // 'undefined startTime AND defined endTime' edge case.
      const payload = {
        windows: windows.map((w) => ({
          fromDate: w.fromDate,
          toDate: w.toDate,
          startTime: w.startTime || null,
          endTime: w.endTime || null,
          label: w.label || null,
        })),
      };

      if (!bypassConfirm) {
        // Preview first
        const r = await fetch(
          `/api/admin/centers/${centerId}/members/${membershipId}/date-availability?preview=true`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          },
        );
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body?.error || `HTTP ${r.status}`);

        if (body.impactedCount > 0) {
          setImpactedCount(body.impactedCount);
          setShowConfirm(true);
          setSaving(false);
          return;
        }
      }

      const r = await fetch(
        `/api/admin/centers/${centerId}/members/${membershipId}/date-availability`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
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
    <div className="space-y-2">
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
        title="Delete Range"
        message="Are you sure you want to delete this date range? This might impact existing bookings when you save."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => {
          if (pendingDeleteIdx !== null) remove(pendingDeleteIdx);
        }}
        onCancel={() => setPendingDeleteIdx(null)}
      />

      <p className="text-[11px] text-slate-500 leading-relaxed">
        Custom date ranges. Each row covers a date span (inclusive) plus
        an optional time window inside the day. Leave time fields empty
        for &ldquo;all day&rdquo;. Date-range availability overrides the recurring
        schedule for the dates it covers.
      </p>
      {windows.length === 0 ? (
        <p className="text-[11px] text-slate-600 italic py-2">
          No date ranges configured.
        </p>
      ) : (
        <div className="space-y-2">
          {windows.map((w, i) => (
            <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto_auto_1fr_auto] gap-2 items-center bg-white/[0.02] border border-white/[0.05] rounded-lg p-2">
              <label className="block">
                <span className="text-[10px] text-slate-500 uppercase tracking-wide">From</span>
                <input
                  type="date"
                  value={w.fromDate}
                  onChange={(e) => update(i, { fromDate: e.target.value })}
                  className="mt-0.5 w-full bg-white/[0.04] border border-white/[0.1] text-white rounded px-2 py-1.5 text-xs outline-none focus:border-accent [color-scheme:dark]"
                />
              </label>
              <label className="block">
                <span className="text-[10px] text-slate-500 uppercase tracking-wide">To</span>
                <input
                  type="date"
                  value={w.toDate}
                  onChange={(e) => update(i, { toDate: e.target.value })}
                  className="mt-0.5 w-full bg-white/[0.04] border border-white/[0.1] text-white rounded px-2 py-1.5 text-xs outline-none focus:border-accent [color-scheme:dark]"
                />
              </label>
              <label className="block">
                <span className="text-[10px] text-slate-500 uppercase tracking-wide">Start (opt)</span>
                <input
                  type="time"
                  value={w.startTime}
                  onChange={(e) => update(i, { startTime: e.target.value })}
                  className="mt-0.5 w-full bg-white/[0.04] border border-white/[0.1] text-white rounded px-2 py-1.5 text-xs outline-none focus:border-accent [color-scheme:dark]"
                />
              </label>
              <label className="block">
                <span className="text-[10px] text-slate-500 uppercase tracking-wide">End (opt)</span>
                <input
                  type="time"
                  value={w.endTime}
                  onChange={(e) => update(i, { endTime: e.target.value })}
                  className="mt-0.5 w-full bg-white/[0.04] border border-white/[0.1] text-white rounded px-2 py-1.5 text-xs outline-none focus:border-accent [color-scheme:dark]"
                />
              </label>
              <label className="block">
                <span className="text-[10px] text-slate-500 uppercase tracking-wide">Label (opt)</span>
                <input
                  type="text"
                  value={w.label}
                  onChange={(e) => update(i, { label: e.target.value })}
                  placeholder="e.g. Tournament"
                  className="mt-0.5 w-full bg-white/[0.04] border border-white/[0.1] text-white rounded px-2 py-1.5 text-xs outline-none focus:border-accent placeholder:text-slate-600"
                />
              </label>
              <div className="flex items-end justify-end h-full">
                <button
                  type="button"
                  onClick={() => setPendingDeleteIdx(i)}
                  className="p-1.5 rounded-lg text-red-400/70 hover:bg-red-500/10 hover:text-red-400 cursor-pointer"
                  title="Delete Range"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between gap-2 pt-1.5">
        <button
          type="button"
          onClick={add}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-slate-300 bg-white/[0.04] hover:bg-white/[0.08] cursor-pointer"
        >
          <Plus className="w-3 h-3" /> Add range
        </button>
        <div className="flex items-center gap-2">
          {msg && (
            <span className={`text-xs font-medium ${msg.ok ? 'text-emerald-400' : 'text-red-400'}`}>
              {msg.text}
            </span>
          )}
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="px-2.5 py-1.5 rounded-lg text-xs text-slate-300 bg-white/[0.04] hover:bg-white/[0.08] cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-black text-xs font-semibold hover:bg-accent/90 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

