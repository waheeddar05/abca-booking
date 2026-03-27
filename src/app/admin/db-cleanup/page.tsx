'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
  DatabaseZap,
  Loader2,
  AlertTriangle,
  Check,
  Trash2,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';

const SUPER_ADMIN_EMAIL = 'waheeddar8@gmail.com';

interface CleanupStep {
  model: string;
  label: string;
  count: number;
}

interface CleanupGroup {
  label: string;
  description: string;
  totalRows: number;
  steps: CleanupStep[];
}

interface CleanupResult {
  model: string;
  label: string;
  deleted: number;
}

export default function DbCleanupPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const isSuperAdmin = session?.user?.email === SUPER_ADMIN_EMAIL;

  const [groups, setGroups] = useState<Record<string, CleanupGroup>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [cleaning, setCleaning] = useState(false);
  const [results, setResults] = useState<CleanupResult[] | null>(null);
  const [totalDeleted, setTotalDeleted] = useState(0);
  const [error, setError] = useState('');
  const [confirmText, setConfirmText] = useState('');

  useEffect(() => {
    if (session && !isSuperAdmin) {
      router.replace('/admin');
      return;
    }
    if (session) fetchGroups();
  }, [session]);

  async function fetchGroups() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/db-cleanup');
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setGroups(data.groups);
    } catch {
      setError('Failed to load table data');
    } finally {
      setLoading(false);
    }
  }

  function toggleGroup(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setResults(null);
    setConfirmText('');
  }

  function selectAll() {
    setSelected(new Set(Object.keys(groups)));
    setResults(null);
    setConfirmText('');
  }

  function clearSelection() {
    setSelected(new Set());
    setResults(null);
    setConfirmText('');
  }

  async function handleCleanup() {
    if (confirmText !== 'DELETE') return;
    setCleaning(true);
    setError('');
    setResults(null);
    try {
      const res = await fetch('/api/admin/db-cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groups: Array.from(selected) }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Cleanup failed');
      }
      const data = await res.json();
      setResults(data.results);
      setTotalDeleted(data.totalDeleted);
      setSelected(new Set());
      setConfirmText('');
      // Refresh counts
      fetchGroups();
    } catch (e: any) {
      setError(e.message || 'Cleanup failed');
    } finally {
      setCleaning(false);
    }
  }

  if (!isSuperAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
        <ShieldAlert className="w-12 h-12 text-red-400" />
        <p className="text-slate-400 text-sm">Super admin access required</p>
      </div>
    );
  }

  const selectedTotalRows = Array.from(selected).reduce(
    (sum, key) => sum + (groups[key]?.totalRows || 0),
    0
  );

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={DatabaseZap}
        title="Database Cleanup"
        description="Cascade-safe deletion of database tables"
        iconColor="text-red-400"
        iconBg="bg-red-500/10"
      >
        <button
          onClick={fetchGroups}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-white/[0.06] text-slate-300 hover:bg-white/[0.1] transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </AdminPageHeader>

      {/* Warning banner */}
      <div className="flex items-start gap-3 p-4 rounded-2xl bg-red-500/[0.08] border border-red-500/20">
        <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-red-300">Danger Zone</p>
          <p className="text-xs text-red-300/70 mt-1">
            This permanently deletes data from the production database. Foreign
            key dependencies are handled automatically in the correct order.
            This action cannot be undone.
          </p>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Results banner */}
      {results && (
        <div className="p-4 rounded-2xl bg-emerald-500/[0.08] border border-emerald-500/20">
          <div className="flex items-center gap-2 mb-3">
            <Check className="w-5 h-5 text-emerald-400" />
            <p className="text-sm font-semibold text-emerald-300">
              Cleanup Complete — {totalDeleted.toLocaleString()} rows deleted
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {results
              .filter((r) => r.deleted > 0)
              .map((r) => (
                <div
                  key={r.model}
                  className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-white/[0.04] text-xs"
                >
                  <span className="text-slate-300">{r.label}</span>
                  <span className="text-emerald-400 font-mono font-bold">
                    -{r.deleted}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 text-accent animate-spin" />
        </div>
      ) : (
        <>
          {/* Quick actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={selectAll}
              className="text-xs text-accent hover:text-accent/80 font-medium transition-colors"
            >
              Select All
            </button>
            <span className="text-slate-600">|</span>
            <button
              onClick={clearSelection}
              className="text-xs text-slate-400 hover:text-slate-300 font-medium transition-colors"
            >
              Clear
            </button>
            {selected.size > 0 && (
              <span className="text-xs text-slate-500 ml-2">
                {selected.size} group{selected.size > 1 ? 's' : ''} selected
                ({selectedTotalRows.toLocaleString()} rows)
              </span>
            )}
          </div>

          {/* Cleanup groups */}
          <div className="grid gap-3">
            {Object.entries(groups).map(([key, group]) => {
              const isSelected = selected.has(key);
              return (
                <button
                  key={key}
                  onClick={() => toggleGroup(key)}
                  className={`w-full text-left p-4 rounded-2xl border transition-all duration-200 ${
                    isSelected
                      ? 'bg-red-500/[0.08] border-red-500/30'
                      : 'bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.05]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${
                            isSelected
                              ? 'bg-red-500 border-red-500'
                              : 'border-slate-600'
                          }`}
                        >
                          {isSelected && (
                            <Check className="w-3 h-3 text-white" />
                          )}
                        </div>
                        <h3
                          className={`text-sm font-semibold ${
                            isSelected ? 'text-red-300' : 'text-white'
                          }`}
                        >
                          {group.label}
                        </h3>
                      </div>
                      <p className="text-xs text-slate-500 mt-1.5 ml-7">
                        {group.description}
                      </p>
                      {/* Step breakdown */}
                      <div className="flex flex-wrap gap-2 mt-2.5 ml-7">
                        {group.steps.map((step) => (
                          <span
                            key={step.model}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/[0.04] text-[10px] text-slate-400"
                          >
                            {step.label}
                            <span className="font-mono font-bold text-slate-300">
                              {step.count.toLocaleString()}
                            </span>
                          </span>
                        ))}
                      </div>
                    </div>
                    <div
                      className={`text-right flex-shrink-0 ${
                        group.totalRows === 0
                          ? 'text-slate-600'
                          : isSelected
                          ? 'text-red-400'
                          : 'text-slate-400'
                      }`}
                    >
                      <div className="text-lg font-bold font-mono">
                        {group.totalRows.toLocaleString()}
                      </div>
                      <div className="text-[10px] text-slate-500">rows</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Confirmation & execute */}
          {selected.size > 0 && (
            <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.06] space-y-4">
              <div>
                <label className="text-xs text-slate-400 block mb-2">
                  Type <span className="font-mono font-bold text-red-400">DELETE</span> to
                  confirm
                </label>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="Type DELETE"
                  className="w-full sm:w-64 px-3 py-2 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white text-sm placeholder-slate-600 focus:outline-none focus:border-red-500/50 font-mono"
                  autoComplete="off"
                />
              </div>
              <button
                onClick={handleCleanup}
                disabled={confirmText !== 'DELETE' || cleaning}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-red-600 hover:bg-red-500 text-white"
              >
                {cleaning ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
                {cleaning
                  ? 'Cleaning...'
                  : `Delete ${selectedTotalRows.toLocaleString()} rows from ${selected.size} group${selected.size > 1 ? 's' : ''}`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
