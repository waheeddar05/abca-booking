'use client';

/**
 * Admin → Sidearm tab.
 *
 * Lists every SIDEARM_SPECIALIST membership at the current center.
 * Lets the admin:
 *   - Reorder priority (1 = first pick by `pickStaffFor`)
 *   - Edit weekly availability, including its effective date range
 *     (PUT /availability)
 *
 * The specialist card + availability editor are shared with the
 * user-facing Sidearm tab (`/sidearm`) via
 * `src/components/sidearm/AvailabilityEditors.tsx`, so both surfaces
 * render the exact same UI and write to the same tables.
 *
 * Resource-based centers only. The sidebar link is gated on
 * bookingModel='RESOURCE_BASED' so ABCA admins don't see this page;
 * if they manage to navigate here directly, the loader returns an
 * empty list (ABCA never has SIDEARM_SPECIALIST memberships).
 */

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useCenter } from '@/lib/center-context';
import { Loader2, ArrowUp, ArrowDown, Users } from 'lucide-react';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { SpecialistAvailabilityCard, type Specialist } from '@/components/sidearm/AvailabilityEditors';

export default function AdminSidearmPage() {
  const { data: session } = useSession();
  const { currentCenter, loading: centerLoading } = useCenter();
  const [specialists, setSpecialists] = useState<Specialist[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingPriorityId, setSavingPriorityId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
            <SpecialistAvailabilityCard
              key={s.id}
              specialist={s}
              weeklyEndpoint={`/api/admin/centers/${currentCenter.id}/members/${s.id}/availability`}
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
                    disabled={idx === specialists.length - 1 || savingPriorityId !== null}
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
