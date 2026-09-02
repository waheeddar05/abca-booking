'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCcw, RotateCcw, IndianRupee } from 'lucide-react';
import { useCurrentUser } from '@/lib/current-user';
import { useRouter } from 'next/navigation';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { AdminCard } from '@/components/admin/AdminCard';

/**
 * Super-admin tool: list of "orphaned captures" — payments where
 * Razorpay says CAPTURED but no booking exists. Built reactively to
 * the support tickets where users paid but didn't get a slot.
 *
 * Two recovery paths per row:
 *   - Retry booking: re-runs the same booking pipeline using the
 *     bookingPayload stored on the payment.
 *   - Refund: returns the money via Razorpay (handles when slot is
 *     no longer available or the user has moved on).
 */

interface OrphanRow {
  id: string;
  createdAt: string;
  amount: number;
  currency: string;
  razorpayOrderId: string;
  razorpayPaymentId: string | null;
  center: { id: string; slug: string; name: string } | null;
  user: { id: string; name: string | null; email: string | null; mobileNumber: string | null } | null;
  failureReason: string | null;
  recovery: { flaggedAt?: string; reason?: string; handled?: boolean } | null;
  hasBookingPayload: boolean;
  slotsRequested: number;
}

export default function OrphanedPaymentsPage() {
  // Profile, not NextAuth session — see @/lib/current-user.
  const { user, loading: userLoading } = useCurrentUser();
  const router = useRouter();
  const isSuperAdmin = user?.isSuperAdmin === true;

  const [rows, setRows] = useState<OrphanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!userLoading && user && !isSuperAdmin) router.replace('/admin');
  }, [userLoading, user, isSuperAdmin, router]);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/payments/orphans');
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || 'Failed to load');
        return;
      }
      setRows(data.rows ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isSuperAdmin) refresh();
  }, [isSuperAdmin]);

  const act = async (id: string, action: 'retry' | 'refund') => {
    if (action === 'refund' && !confirm('Refund this payment to the user? This is irreversible.')) return;
    setBusyId(id);
    setToast(null);
    try {
      const res = await fetch(`/api/admin/payments/${id}/recover?action=${action}`, {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setToast({ ok: false, text: data?.error || `${action} failed` });
        return;
      }
      setToast({
        ok: true,
        text:
          action === 'retry'
            ? `Booking created (${(data.bookingIds ?? []).length})`
            : 'Refund initiated',
      });
      refresh();
    } finally {
      setBusyId(null);
    }
  };

  if (!isSuperAdmin) {
    return <div className="p-6 text-slate-400 text-sm">Super admin access required.</div>;
  }

  return (
    <div className="space-y-4">
      <AdminPageHeader
        icon={AlertTriangle}
        title="Orphaned payments"
        description="Captured but no booking — manual recovery"
        iconColor="text-amber-400"
        iconBg="bg-amber-500/10"
      >
        <button
          onClick={refresh}
          disabled={loading}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-slate-300 bg-white/[0.04] hover:bg-white/[0.08] cursor-pointer disabled:opacity-60"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCcw className="w-3.5 h-3.5" />}
          Refresh
        </button>
      </AdminPageHeader>

      {toast && (
        <div
          className={`px-3 py-2 rounded-xl border text-xs ${
            toast.ok
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
              : 'bg-red-500/10 border-red-500/30 text-red-200'
          }`}
        >
          {toast.text}
        </div>
      )}

      <AdminCard>
        <div className="p-4">
          {loading ? (
            <div className="flex items-center gap-2 py-6 justify-center text-sm text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : error ? (
            <div className="text-sm text-red-300 py-3">{error}</div>
          ) : rows.length === 0 ? (
            <div className="text-center text-emerald-400/80 text-sm py-6">
              No orphaned captures in the last 30 days.
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-xs text-slate-400 mb-2">
                Showing {rows.length} captured-but-not-booked payment{rows.length === 1 ? '' : 's'} from the last 30 days.
              </div>
              {rows.map((row) => (
                <div
                  key={row.id}
                  className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-3 space-y-2"
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <span className="text-sm font-semibold text-white">
                          {row.user?.name || row.user?.email || row.user?.mobileNumber || '(no user)'}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded border bg-purple-500/10 text-purple-300 border-purple-500/30 uppercase tracking-wide">
                          {row.center?.name ?? row.center?.slug ?? '—'}
                        </span>
                        <span className="text-[10px] flex items-center text-emerald-400 font-semibold">
                          <IndianRupee className="w-3 h-3" />{row.amount}
                        </span>
                        <span className="text-[10px] text-slate-500">
                          {new Date(row.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono truncate">
                        {row.razorpayOrderId} · {row.razorpayPaymentId ?? '—'}
                      </div>
                      {row.recovery?.reason && (
                        <div className="text-[11px] text-amber-300/80 mt-1">
                          ⚠ {row.recovery.reason}
                        </div>
                      )}
                      {row.failureReason && row.failureReason !== row.recovery?.reason && (
                        <div className="text-[11px] text-red-300/80 mt-0.5">
                          {row.failureReason}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1.5 flex-shrink-0">
                      <button
                        onClick={() => act(row.id, 'retry')}
                        disabled={busyId === row.id || !row.hasBookingPayload}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-emerald-200 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        title={
                          row.hasBookingPayload
                            ? `Retry booking creation (${row.slotsRequested} slot${row.slotsRequested === 1 ? '' : 's'})`
                            : 'No bookingPayload stored — refund instead'
                        }
                      >
                        <RotateCcw className="w-3 h-3" />
                        Retry
                      </button>
                      <button
                        onClick={() => act(row.id, 'refund')}
                        disabled={busyId === row.id}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-red-200 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 cursor-pointer disabled:opacity-40"
                      >
                        Refund
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </AdminCard>
    </div>
  );
}
