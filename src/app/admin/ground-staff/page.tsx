'use client';

/**
 * Admin → Ground Staff tab.
 *
 * Lists every GROUND_STAFF membership at the current center. Lets the
 * admin:
 *   - Reorder priority (1 = first contact for nets / full-court bookings)
 *   - Edit recurring weekly availability
 *   - Edit date-range availability
 *
 * Mirrors Admin → Sidearm and Admin → Personal Coach exactly. The staff
 * card + availability editors are shared via
 * `src/components/sidearm/AvailabilityEditors.tsx`, so every staff-style
 * tab renders the exact same UI and writes to the same tables (the
 * availability / priority endpoints key off the membership id, not the
 * role, so they work unchanged for ground staff).
 *
 * Resource-based centers only. The sidebar link is gated on
 * bookingModel='RESOURCE_BASED' so ABCA admins don't see this page;
 * if they manage to navigate here directly, the loader returns an
 * empty list (ABCA never has GROUND_STAFF memberships).
 *
 * Unlike Sidearm/Coach there is no self-service variant: GROUND_STAFF is
 * a center-side facility role with no corresponding UserRole, so a ground
 * staff member can't reach /admin themselves. This page is admin-only.
 */

import { useEffect, useState } from 'react';
import { useCenter } from '@/lib/center-context';
import { Loader2, ArrowUp, ArrowDown, HardHat } from 'lucide-react';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { SpecialistAvailabilityCard, type Specialist } from '@/components/sidearm/AvailabilityEditors';

export default function AdminGroundStaffPage() {
  const { currentCenter, loading: centerLoading } = useCenter();
  const [staff, setStaff] = useState<Specialist[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingPriorityId, setSavingPriorityId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    if (!currentCenter) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/admin/centers/${currentCenter.id}/members?role=GROUND_STAFF`,
      );
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${r.status}`);
      }
      const list = (await r.json()) as Specialist[];
      setStaff(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load ground staff');
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
    if (otherIdx < 0 || otherIdx >= staff.length) return;
    const a = staff[idx];
    const b = staff[otherIdx];

    // Use sequential integers so the list stays cleanly numbered.
    // Re-index from 1 over the entire list so a stretched legacy
    // priority (e.g. 100, 100, 100) collapses to 1..N on first move.
    const reindexed = staff.map((s, i) => ({
      ...s,
      priority: i === idx ? otherIdx + 1 : i === otherIdx ? idx + 1 : i + 1,
    }));
    // Swap the two rows in display order so the ArrowUp on the row
    // visually moves it up immediately, before the save round-trips.
    [reindexed[idx], reindexed[otherIdx]] = [reindexed[otherIdx], reindexed[idx]];
    setStaff(reindexed);

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
          icon={HardHat}
          title="Ground Staff"
          description="Manage ground staff, availability, and priority order."
        />
        <p className="text-sm text-slate-400">
          Ground Staff management is only available for resource-based centers.
          {currentCenter.shortName ?? currentCenter.name} uses the legacy
          machine/pitch model — ground staff aren&apos;t exposed there.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <AdminPageHeader
        icon={HardHat}
        title="Ground Staff"
        description="Facility staff who serve as the default contact for Cricket Nets and Full Indoor Court bookings. Priority drives who is contacted first; availability filters which slots they cover."
      />

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/[0.05] px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {staff.length === 0 ? (
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-6 text-center text-sm text-slate-400">
          No ground staff at this center yet.
          <br />
          Add one via{' '}
          <a
            href={`/admin/centers/${currentCenter.id}`}
            className="text-accent underline hover:no-underline"
          >
            Center → Members
          </a>
          {' '}with role &ldquo;Ground Staff&rdquo;.
        </div>
      ) : (
        <div className="space-y-3">
          {staff.map((s, idx) => (
            <SpecialistAvailabilityCard
              key={s.id}
              specialist={s}
              weeklyEndpoint={`/api/admin/centers/${currentCenter.id}/members/${s.id}/availability`}
              dateEndpoint={`/api/admin/centers/${currentCenter.id}/members/${s.id}/date-availability`}
              onChanged={refresh}
              leading={
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
                    disabled={idx === staff.length - 1 || savingPriorityId !== null}
                    className="p-1 rounded text-slate-400 bg-white/[0.04] hover:bg-white/[0.08] disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                    title="Move down in priority"
                  >
                    <ArrowDown className="w-3 h-3" />
                  </button>
                </div>
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
