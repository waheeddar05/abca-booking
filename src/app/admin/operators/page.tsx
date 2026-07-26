'use client';

/**
 * Admin → Operators tab.
 *
 * Lists every OPERATOR membership at the current center. Lets the admin:
 *   - Reorder priority (1 = first operator picked for a booking)
 *   - Edit weekly availability, including its effective date range
 *
 * This is a deliberate 1:1 mirror of Admin → Ground Staff (and therefore
 * of Sidearm / Personal Coach). The staff card + availability editor are
 * shared via `src/components/sidearm/AvailabilityEditors.tsx`, and the
 * availability / priority endpoints key off the membership id rather than
 * the role, so they work unchanged for operators.
 *
 * What this replaced: an operator-only configuration surface with three
 * tabs — a per-day/per-slab "operator count" schedule policy, date
 * overrides, and a day+slab priority matrix — plus a machine-assignment
 * grid. All of it is gone. Operator allocation is now driven by
 * availability alone:
 *
 *   - An operator is on duty for a slot when their weekly schedule covers
 *     it. An operator with NO schedule is NOT available and is never
 *     auto-assigned — the same rule coaches and sidearm specialists
 *     follow. (Ground staff are the exception: they are a floor contact,
 *     not an assignable resource, so unscheduled means always on hand.)
 *   - Each operator-assisted machine booking consumes one operator, so a
 *     slot can carry exactly as many as are available for it.
 *
 * Operators are not a resource-based-only concept, so unlike Ground Staff
 * this page is not gated on `bookingModel`.
 */

import { useEffect, useState } from 'react';
import { useCenter } from '@/lib/center-context';
import { Loader2, ArrowUp, ArrowDown, UserCog } from 'lucide-react';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { SpecialistAvailabilityCard, type Specialist } from '@/components/sidearm/AvailabilityEditors';

export default function AdminOperatorsPage() {
  const { currentCenter, loading: centerLoading } = useCenter();
  const [operators, setOperators] = useState<Specialist[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingPriorityId, setSavingPriorityId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    if (!currentCenter) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/admin/centers/${currentCenter.id}/members?role=OPERATOR`,
      );
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${r.status}`);
      }
      const list = (await r.json()) as Specialist[];
      setOperators(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load operators');
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
    if (otherIdx < 0 || otherIdx >= operators.length) return;
    const a = operators[idx];

    // Use sequential integers so the list stays cleanly numbered.
    // Re-index from 1 over the entire list so a stretched legacy
    // priority (e.g. 100, 100, 100) collapses to 1..N on first move.
    const reindexed = operators.map((s, i) => ({
      ...s,
      priority: i === idx ? otherIdx + 1 : i === otherIdx ? idx + 1 : i + 1,
    }));
    // Swap the two rows in display order so the ArrowUp on the row
    // visually moves it up immediately, before the save round-trips.
    [reindexed[idx], reindexed[otherIdx]] = [reindexed[otherIdx], reindexed[idx]];
    setOperators(reindexed);

    setSavingPriorityId(a.id);
    try {
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

  // Operators the booking engine will skip entirely because no weekly
  // window has been entered for them.
  const unscheduledCount = operators.filter((o) => o.availability.length === 0).length;

  return (
    <div className="space-y-4">
      <AdminPageHeader
        icon={UserCog}
        title="Operators"
        description="Staff who run the bowling machines. Availability decides which slots they cover and how many machine bookings a slot can take; priority decides who is assigned first."
        iconColor="text-purple-400"
        iconBg="bg-purple-500/10"
      />

      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-[11px] leading-relaxed text-slate-400">
        Each machine booking with an operator uses one operator, so the number
        of operator-assisted bookings a slot can hold equals the number of
        operators available for it.
      </div>

      {/* Unscheduled operators are invisible to the booking engine, and
          that is easy to miss — call it out with the count so an admin
          knows exactly why a slot shows no operator. */}
      <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.07] px-3 py-2.5 text-[11px] leading-relaxed text-amber-200/90">
        <span className="font-semibold">Availability is required.</span> An
        operator with no weekly schedule is treated as <span className="font-semibold">Not
        Available</span> and is never assigned to a booking. Add their
        availability below to make them eligible.
        {unscheduledCount > 0 && (
          <>
            {' '}Right now {unscheduledCount === 1 ? '1 operator has' : `${unscheduledCount} operators have`}{' '}
            no availability set and {unscheduledCount === 1 ? 'is' : 'are'} not being
            considered for any slot.
          </>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/[0.05] px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {operators.length === 0 ? (
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-6 text-center text-sm text-slate-400">
          No operators at this center yet.
          <br />
          Add one via{' '}
          <a
            href={`/admin/centers/${currentCenter.id}`}
            className="text-accent underline hover:no-underline"
          >
            Center → Members
          </a>
          {' '}with role &ldquo;Operator&rdquo;.
        </div>
      ) : (
        <div className="space-y-3">
          {operators.map((s, idx) => (
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
                    disabled={idx === operators.length - 1 || savingPriorityId !== null}
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
