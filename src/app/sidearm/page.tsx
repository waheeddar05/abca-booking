'use client';

/**
 * User Mode → Sidearm tab.
 *
 * Only reachable by users who hold a SIDEARM_SPECIALIST membership at
 * the current center (the BottomNav tab is gated the same way). It lets
 * a specialist manage *their own* availability — a weekly schedule plus
 * its effective date range — using the exact same card + editor as
 * Admin → Sidearm → Availability.
 *
 * The card and editor are imported from
 * `src/components/sidearm/AvailabilityEditors.tsx` and talk to
 * `/api/sidearm/availability`, which writes to the same
 * MembershipAvailability table the admin tab reads. So anything saved
 * here shows up in Admin Mode immediately, and vice-versa.
 */

import { useEffect, useState } from 'react';
import { useCenter } from '@/lib/center-context';
import { Loader2, Zap } from 'lucide-react';
import { SpecialistAvailabilityCard, type Specialist } from '@/components/sidearm/AvailabilityEditors';

export default function UserSidearmPage() {
  const { currentCenter, loading: centerLoading } = useCenter();
  const [specialist, setSpecialist] = useState<Specialist | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/sidearm/me');
      if (r.status === 403 || r.status === 401) {
        setForbidden(true);
        setSpecialist(null);
        return;
      }
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${r.status}`);
      }
      const body = await r.json();
      setForbidden(false);
      setSpecialist((body?.specialist ?? null) as Specialist | null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load your availability');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (centerLoading) return;
    refresh();
  }, [centerLoading, currentCenter?.id]);

  return (
    <div className="max-w-2xl mx-auto px-4 py-5">
      <div className="fixed inset-0 -z-10 bg-gradient-to-br from-[#0a1628] via-[#132240] to-[#0d1f3c]"></div>
      <div className="fixed inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,rgba(212,168,67,0.05),transparent_60%)]"></div>

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
          <Zap className="w-5 h-5 text-accent" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">My Sidearm Availability</h1>
          <p className="text-xs text-slate-400">
            Set when you&apos;re available for sidearm sessions
          </p>
        </div>
      </div>

      {centerLoading || loading ? (
        <div className="flex items-center gap-2 text-slate-400 py-10 justify-center text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : forbidden ? (
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-6 text-center text-sm text-slate-400">
          You aren&apos;t registered as a sidearm specialist at
          {' '}{currentCenter?.shortName ?? currentCenter?.name ?? 'this center'}.
          <br />
          If you believe this is a mistake, contact the center admin.
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-500/20 bg-red-500/[0.05] px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      ) : specialist ? (
        <div className="space-y-3">
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Your availability is the source of truth for sidearm bookings — users
            can only book you for slots inside these windows. Changes save
            immediately and are visible to center admins.
          </p>
          <SpecialistAvailabilityCard
            specialist={specialist}
            weeklyEndpoint="/api/sidearm/availability"
            onChanged={refresh}
          />
        </div>
      ) : (
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-6 text-center text-sm text-slate-400">
          Could not load your specialist profile. Please try again.
        </div>
      )}
    </div>
  );
}
