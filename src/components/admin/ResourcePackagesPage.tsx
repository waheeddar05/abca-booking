'use client';

/**
 * Top-level packages page for RESOURCE_BASED centers (Toplay et al.).
 *
 * Mirrors the 4-tab UX of the legacy ABCA `/admin/packages` page
 * (`AdminPackagesLegacy`) so resource-based centers get parity for:
 *   - Packages       (manage catalog)
 *   - User Packages  (who owns what)
 *   - Assign         (grant a custom package to a specific user)
 *   - Reports        (sales / consumption stats)
 *
 * The "Packages" tab wraps the existing `ResourcePackageManagement`
 * component unchanged. The remaining three tabs call the same
 * center-scoped admin APIs ABCA uses (`/api/admin/packages/{assign,
 * user-packages, reports}`) — those endpoints already derive `centerId`
 * from `resolveCurrentCenter`, so no extra wiring is needed beyond
 * passing the resource-based discriminators (`category`,
 * `machineRowId`) when creating a custom assignment.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Package,
  Users,
  UserPlus,
  BarChart3,
  Loader2,
  Search,
  Check,
  Download,
  ArrowDownAZ,
  ArrowUpAZ,
} from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { ResourcePackageManagement } from '@/components/admin/ResourcePackageManagement';
import { useCenter } from '@/lib/center-context';

type TabId = 'packages' | 'users' | 'assign' | 'reports';

// Same category set RESOURCE_BASED uses elsewhere (resource-pricing,
// resource-booking, ResourcePackageManagement). FULL_COURT and
// CORPORATE_BATCH are intentionally omitted from the custom-assign
// picker — those aren't session-based redemptions in practice.
const ASSIGN_CATEGORY_OPTIONS = [
  { id: 'MACHINE', label: 'Bowling Machine' },
  { id: 'SIDEARM', label: 'Sidearm' },
  { id: 'COACHING', label: 'Personal Coaching' },
  { id: 'NET', label: 'Cricket Nets' },
];

// Standardized labels — plain "Day" / "Evening" / "Any time" to
// match the rest of the admin packages UI.
const TIMING_OPTIONS = [
  { id: 'DAY', label: 'Day' },
  { id: 'EVENING', label: 'Evening' },
  { id: 'BOTH', label: 'Any time' },
];

interface UserHit {
  id: string;
  name: string | null;
  email: string | null;
  mobileNumber: string | null;
}

interface MachineLite {
  id: string;
  name: string;
  shortName?: string | null;
  isActive: boolean;
}

interface UserPackageRow {
  id: string;
  totalSessions: number;
  usedSessions: number;
  status: string;
  amountPaid: number;
  activationDate: string;
  expiryDate: string;
  package: {
    id: string;
    name: string;
    category: string | null;
    machineType: string;
    timingType: string;
    isCustom?: boolean;
  };
  user: {
    id: string;
    name: string | null;
    email: string | null;
    mobileNumber: string | null;
  };
}

interface ReportData {
  activePackages: number;
  expiredPackages: number;
  cancelledPackages?: number;
  totalSessionsSold: number;
  totalSessionsConsumed: number;
  extraChargesCollected?: number;
  totalRevenue?: number;
}

export function ResourcePackagesPage() {
  const { currentCenter } = useCenter();
  const toast = useToast();

  const [tab, setTab] = useState<TabId>('packages');

  // ─── User Packages tab ───────────────────────────────────────────
  const [userPackages, setUserPackages] = useState<UserPackageRow[]>([]);
  const [userPkgLoading, setUserPkgLoading] = useState(false);
  const [userPkgStatusFilter, setUserPkgStatusFilter] = useState<string>('');
  const [userPkgSearchInput, setUserPkgSearchInput] = useState('');
  const [userPkgSearch, setUserPkgSearch] = useState('');
  const [userPkgSort, setUserPkgSort] = useState<'NAME_ASC' | 'NAME_DESC'>('NAME_ASC');

  const fetchUserPackages = async () => {
    setUserPkgLoading(true);
    try {
      const params = new URLSearchParams();
      if (userPkgStatusFilter) params.set('status', userPkgStatusFilter);
      if (userPkgSearch) params.set('search', userPkgSearch);
      const res = await fetch(`/api/admin/packages/user-packages?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setUserPackages(Array.isArray(data) ? data : data.userPackages || []);
      } else {
        toast.error('Failed to load user packages');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load user packages');
    } finally {
      setUserPkgLoading(false);
    }
  };

  useEffect(() => {
    if (tab === 'users') fetchUserPackages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, userPkgStatusFilter, userPkgSearch]);

  // Sort user packages alphabetically by the holder's name (falling back to
  // email/mobile so unnamed users still order predictably).
  const sortedUserPackages = useMemo(() => {
    const nameOf = (up: UserPackageRow) =>
      (up.user.name || up.user.email || up.user.mobileNumber || '').toLowerCase();
    return [...userPackages].sort((a, b) => {
      const cmp = nameOf(a).localeCompare(nameOf(b));
      return userPkgSort === 'NAME_ASC' ? cmp : -cmp;
    });
  }, [userPackages, userPkgSort]);

  // ─── Reports tab ─────────────────────────────────────────────────
  const [reports, setReports] = useState<ReportData | null>(null);
  const [reportsLoading, setReportsLoading] = useState(false);
  // CSV export — shared backend with ABCA's admin packages page. The
  // route is center-scoped via `resolveCurrentCenter`, so simply
  // calling it from a RESOURCE_BASED context downloads that center's
  // user-package rows.
  const [downloadingCsv, setDownloadingCsv] = useState(false);
  const downloadCsv = async () => {
    setDownloadingCsv(true);
    try {
      const res = await fetch('/api/admin/packages/reports/csv');
      if (!res.ok) throw new Error('Failed to download');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `packages-report-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'CSV download failed');
    } finally {
      setDownloadingCsv(false);
    }
  };

  useEffect(() => {
    if (tab !== 'reports') return;
    let cancelled = false;
    setReportsLoading(true);
    fetch('/api/admin/packages/reports')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (!cancelled) setReports(data); })
      .catch(() => { if (!cancelled) setReports(null); })
      .finally(() => { if (!cancelled) setReportsLoading(false); });
    return () => { cancelled = true; };
  }, [tab]);

  // ─── Assign tab ──────────────────────────────────────────────────
  const [machines, setMachines] = useState<MachineLite[]>([]);
  useEffect(() => {
    if (!currentCenter) return;
    // Centers expose their machine list via the public endpoint; we
    // reuse it here to keep the assign picker in sync with the rest of
    // the resource-based admin UI.
    fetch(`/api/centers/${currentCenter.id}/machines`)
      .then((r) => (r.ok ? r.json() : { machines: [] }))
      .then((data) => setMachines(Array.isArray(data) ? data : data.machines || []))
      .catch(() => setMachines([]));
  }, [currentCenter]);

  const [assignSearch, setAssignSearch] = useState('');
  const [assignSearchResults, setAssignSearchResults] = useState<UserHit[]>([]);
  const [assignSearching, setAssignSearching] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserHit | null>(null);
  const [assignForm, setAssignForm] = useState({
    name: '',
    category: 'MACHINE' as string,
    machineRowId: '' as string,
    timingType: 'BOTH' as string,
    totalSessions: 4,
    validityDays: 30,
  });
  const [assigning, setAssigning] = useState(false);

  useEffect(() => {
    if (!assignSearch || assignSearch.length < 2) {
      setAssignSearchResults([]);
      return;
    }
    let cancelled = false;
    setAssignSearching(true);
    const t = setTimeout(() => {
      fetch(`/api/admin/users/search?q=${encodeURIComponent(assignSearch)}`)
        .then((r) => (r.ok ? r.json() : { users: [] }))
        .then((data) => { if (!cancelled) setAssignSearchResults(data.users ?? []); })
        .catch(() => { if (!cancelled) setAssignSearchResults([]); })
        .finally(() => { if (!cancelled) setAssignSearching(false); });
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [assignSearch]);

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) { toast.error('Select a user first'); return; }
    if (!assignForm.name.trim()) { toast.error('Package name is required'); return; }
    if (assignForm.totalSessions < 1) { toast.error('Sessions must be at least 1'); return; }
    if (assignForm.validityDays < 1) { toast.error('Validity must be at least 1 day'); return; }

    setAssigning(true);
    try {
      // Resource-based custom package — the schema's `machineType`
      // column is non-null so we send 'LEATHER' as a placeholder
      // (same convention as ResourcePackageManagement.tsx).
      const res = await fetch('/api/admin/packages/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: selectedUser.id,
          name: assignForm.name.trim(),
          machineType: 'LEATHER',
          timingType: assignForm.timingType,
          totalSessions: assignForm.totalSessions,
          validityDays: assignForm.validityDays,
          category: assignForm.category,
          machineRowId: assignForm.machineRowId || null,
        }),
      });
      if (res.ok) {
        toast.success(`Custom package assigned to ${selectedUser.name || selectedUser.mobileNumber || selectedUser.email}`);
        setSelectedUser(null);
        setAssignSearch('');
        setAssignSearchResults([]);
        setAssignForm({ name: '', category: 'MACHINE', machineRowId: '', timingType: 'BOTH', totalSessions: 4, validityDays: 30 });
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || 'Failed to assign package');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to assign package');
    } finally {
      setAssigning(false);
    }
  };

  // ─── Render ──────────────────────────────────────────────────────
  const TABS: Array<{ id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }> = useMemo(
    () => [
      { id: 'packages', label: 'Packages',      icon: Package },
      { id: 'users',    label: 'User Packages', icon: Users },
      { id: 'assign',   label: 'Assign',        icon: UserPlus },
      { id: 'reports',  label: 'Reports',       icon: BarChart3 },
    ],
    [],
  );

  return (
    <div>
      <AdminPageHeader
        icon={Package}
        title="Packages"
        description="Manage package catalog, view who owns what, assign custom packages, and review sales."
      />

      {/* Tab nav — matches the visual treatment of /admin/centers/[id]
          (border-bottom strip with active border accent). Same pattern
          as AdminPackagesLegacy so both surfaces feel like one
          consistent admin app. */}
      <div className="flex gap-1 overflow-x-auto -mx-1 px-1 pb-2 mb-4 border-b border-white/[0.06] no-scrollbar">
        {TABS.map((t) => {
          const Icon = t.icon;
          const on = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                on
                  ? 'bg-accent/10 text-accent border-b-2 border-accent'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {tab === 'packages' && <ResourcePackageManagement />}

      {tab === 'users' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <select
              value={userPkgStatusFilter}
              onChange={(e) => setUserPkgStatusFilter(e.target.value)}
              className="bg-white/[0.04] border border-white/[0.1] text-white rounded-lg px-3 py-2 text-xs outline-none focus:border-accent"
            >
              <option value="">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="EXPIRED">Expired</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
            <form
              onSubmit={(e) => { e.preventDefault(); setUserPkgSearch(userPkgSearchInput.trim()); }}
              className="flex items-center gap-2"
            >
              <input
                value={userPkgSearchInput}
                onChange={(e) => setUserPkgSearchInput(e.target.value)}
                placeholder="Search by user name / email / mobile"
                className="bg-white/[0.04] border border-white/[0.1] text-white rounded-lg px-3 py-2 text-xs outline-none focus:border-accent w-64"
              />
              <button
                type="submit"
                className="px-3 py-2 rounded-lg text-xs font-semibold bg-white/[0.06] hover:bg-white/[0.1] text-slate-200 cursor-pointer"
              >
                Search
              </button>
            </form>
            <button
              type="button"
              onClick={() => setUserPkgSort((s) => (s === 'NAME_ASC' ? 'NAME_DESC' : 'NAME_ASC'))}
              title={userPkgSort === 'NAME_ASC' ? 'Sorted A–Z (tap for Z–A)' : 'Sorted Z–A (tap for A–Z)'}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-semibold bg-white/[0.04] border border-white/[0.1] text-slate-200 hover:bg-white/[0.08] cursor-pointer"
            >
              {userPkgSort === 'NAME_ASC'
                ? <ArrowDownAZ className="w-3.5 h-3.5" />
                : <ArrowUpAZ className="w-3.5 h-3.5" />}
              {userPkgSort === 'NAME_ASC' ? 'A–Z' : 'Z–A'}
            </button>
          </div>

          {userPkgLoading ? (
            <div className="flex items-center justify-center py-10 text-slate-400 text-sm gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : userPackages.length === 0 ? (
            <p className="text-xs text-slate-500 italic py-10 text-center">No user packages match the current filters.</p>
          ) : (
            <div className="space-y-2">
              {sortedUserPackages.map((up) => (
                <div
                  key={up.id}
                  className="rounded-xl bg-white/[0.03] border border-white/[0.07] p-3 flex flex-wrap items-start justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-white truncate">
                      {up.user.name || '(no name)'}
                      <span className="ml-2 text-[11px] text-slate-400 font-normal">
                        {up.user.mobileNumber || up.user.email || up.user.id}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1.5 items-center">
                      <span className="text-[10px] text-purple-300/80 px-1.5 py-0.5 rounded bg-purple-500/10">
                        {up.package.name}
                      </span>
                      {up.package.category && (
                        <span className="text-[10px] text-cyan-300/80 px-1.5 py-0.5 rounded bg-cyan-500/10">
                          {up.package.category}
                        </span>
                      )}
                      {up.package.isCustom && (
                        <span className="text-[10px] text-amber-300/80 px-1.5 py-0.5 rounded bg-amber-500/10">
                          Custom
                        </span>
                      )}
                      <span className="text-[10px] text-slate-300 px-1.5 py-0.5 rounded bg-white/[0.04]">
                        {up.usedSessions} / {up.totalSessions} sessions
                      </span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded ${
                          up.status === 'ACTIVE'
                            ? 'text-emerald-300 bg-emerald-500/10'
                            : up.status === 'EXPIRED'
                              ? 'text-slate-400 bg-slate-500/10'
                              : 'text-red-300 bg-red-500/10'
                        }`}
                      >
                        {up.status}
                      </span>
                      <span className="text-[10px] text-slate-400 px-1.5 py-0.5 rounded bg-white/[0.04]">
                        ₹{up.amountPaid}
                      </span>
                    </div>
                  </div>
                  <div className="text-[10px] text-slate-500 text-right shrink-0">
                    Activated: {new Date(up.activationDate).toLocaleDateString('en-IN')}
                    <br />
                    Expires: {new Date(up.expiryDate).toLocaleDateString('en-IN')}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'assign' && (
        <div className="space-y-3 max-w-2xl">
          {/* User picker */}
          <div className="bg-white/[0.03] border border-white/[0.07] rounded-xl p-3">
            <h3 className="text-xs font-bold text-white mb-2 flex items-center gap-2">
              <Search className="w-3.5 h-3.5 text-accent" />
              Select user
            </h3>
            {selectedUser ? (
              <div className="flex items-center justify-between bg-accent/10 border border-accent/30 rounded-lg px-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white truncate">
                    {selectedUser.name || '(no name)'}
                  </div>
                  <div className="text-xs text-slate-400 truncate">
                    {selectedUser.mobileNumber || selectedUser.email || selectedUser.id}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => { setSelectedUser(null); setAssignSearch(''); setAssignSearchResults([]); }}
                  className="text-xs text-red-400 hover:text-red-300 cursor-pointer shrink-0"
                >
                  Change
                </button>
              </div>
            ) : (
              <div>
                <div className="relative">
                  <input
                    type="text"
                    value={assignSearch}
                    onChange={(e) => setAssignSearch(e.target.value)}
                    placeholder="Search by name, mobile, or email…"
                    className="w-full bg-white/[0.04] border border-white/[0.1] text-white text-sm rounded-lg px-3 py-2 outline-none focus:border-accent placeholder:text-slate-500"
                  />
                  {assignSearching && <Loader2 className="w-4 h-4 animate-spin text-slate-400 absolute right-3 top-3" />}
                </div>
                {assignSearchResults.length > 0 && (
                  <div className="mt-2 max-h-48 overflow-y-auto space-y-1">
                    {assignSearchResults.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => { setSelectedUser(u); setAssignSearchResults([]); setAssignSearch(''); }}
                        className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/[0.06] transition-colors cursor-pointer"
                      >
                        <span className="text-sm text-white">{u.name || '(no name)'}</span>
                        <span className="text-xs text-slate-400 ml-2">{u.mobileNumber || u.email}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Custom package form (resource-based fields) */}
          <form onSubmit={handleAssign} className="bg-white/[0.03] border border-white/[0.07] rounded-xl p-3 space-y-3">
            <h3 className="text-xs font-bold text-white flex items-center gap-2">
              <Package className="w-3.5 h-3.5 text-accent" />
              Package details
            </h3>

            <div>
              <label className="block text-[10px] font-medium text-slate-400 mb-1">Package name</label>
              <input
                type="text"
                value={assignForm.name}
                onChange={(e) => setAssignForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Custom 10 sessions for John"
                className="w-full bg-white/[0.04] border border-white/[0.1] text-white text-sm rounded-lg px-3 py-2 outline-none focus:border-accent placeholder:text-slate-500"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-medium text-slate-400 mb-1">Category</label>
                <select
                  value={assignForm.category}
                  onChange={(e) => setAssignForm((f) => ({ ...f, category: e.target.value, machineRowId: '' }))}
                  className="w-full bg-white/[0.04] border border-white/[0.1] text-white text-sm rounded-lg px-3 py-2 outline-none focus:border-accent"
                >
                  {ASSIGN_CATEGORY_OPTIONS.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </div>
              {assignForm.category === 'MACHINE' && (
                <div>
                  <label className="block text-[10px] font-medium text-slate-400 mb-1">Machine (optional)</label>
                  <select
                    value={assignForm.machineRowId}
                    onChange={(e) => setAssignForm((f) => ({ ...f, machineRowId: e.target.value }))}
                    className="w-full bg-white/[0.04] border border-white/[0.1] text-white text-sm rounded-lg px-3 py-2 outline-none focus:border-accent"
                  >
                    <option value="">Any machine</option>
                    {machines.filter((m) => m.isActive).map((m) => (
                      <option key={m.id} value={m.id}>{m.shortName || m.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-[10px] font-medium text-slate-400 mb-1">Timing</label>
                <select
                  value={assignForm.timingType}
                  onChange={(e) => setAssignForm((f) => ({ ...f, timingType: e.target.value }))}
                  className="w-full bg-white/[0.04] border border-white/[0.1] text-white text-sm rounded-lg px-3 py-2 outline-none focus:border-accent"
                >
                  {TIMING_OPTIONS.map((t) => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-medium text-slate-400 mb-1">Sessions</label>
                <input
                  type="number"
                  min={1}
                  value={assignForm.totalSessions}
                  onChange={(e) => setAssignForm((f) => ({ ...f, totalSessions: parseInt(e.target.value) || 0 }))}
                  className="w-full bg-white/[0.04] border border-white/[0.1] text-white text-sm rounded-lg px-3 py-2 outline-none focus:border-accent"
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-slate-400 mb-1">Validity (days)</label>
                <input
                  type="number"
                  min={1}
                  value={assignForm.validityDays}
                  onChange={(e) => setAssignForm((f) => ({ ...f, validityDays: parseInt(e.target.value) || 0 }))}
                  className="w-full bg-white/[0.04] border border-white/[0.1] text-white text-sm rounded-lg px-3 py-2 outline-none focus:border-accent"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={assigning || !selectedUser}
              className="w-full bg-accent hover:bg-accent-light text-primary font-semibold py-3 rounded-xl text-sm transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {assigning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {assigning ? 'Assigning…' : 'Assign custom package'}
            </button>
          </form>
        </div>
      )}

      {tab === 'reports' && (
        reportsLoading ? (
          <div className="flex items-center justify-center py-16 text-slate-400 text-sm gap-2">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading reports…
          </div>
        ) : reports ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
              {[
                { label: 'Active packages',     value: reports.activePackages },
                { label: 'Expired packages',    value: reports.expiredPackages },
                { label: 'Cancelled packages',  value: reports.cancelledPackages ?? 0 },
                { label: 'Sessions sold',       value: reports.totalSessionsSold },
                { label: 'Sessions consumed',   value: reports.totalSessionsConsumed },
                { label: 'Extra charges',       value: `₹${reports.extraChargesCollected ?? 0}` },
                { label: 'Total revenue',       value: `₹${reports.totalRevenue ?? 0}` },
              ].map((stat) => (
                <div key={stat.label} className="bg-white/[0.03] border border-white/[0.07] rounded-xl p-3">
                  <p className="text-[10px] text-slate-400 mb-0.5 leading-tight">{stat.label}</p>
                  <p className="text-base font-bold text-white">{stat.value}</p>
                </div>
              ))}
            </div>

            {/* Download CSV — shared route with the legacy ABCA admin
                page. The handler is already center-scoped and emits
                the new Booking Category column + "Not Applicable"
                ball-type cells for non-machine packages. */}
            <div className="bg-white/[0.03] border border-white/[0.07] rounded-xl p-3">
              <h3 className="text-xs font-bold text-white mb-3 flex items-center gap-2">
                <Download className="w-3.5 h-3.5 text-accent" />
                Export Packages Report
              </h3>
              <button
                onClick={downloadCsv}
                disabled={downloadingCsv}
                className="inline-flex items-center gap-2 bg-accent hover:bg-accent-light text-primary px-4 py-2 rounded-xl text-sm font-semibold transition-all cursor-pointer disabled:opacity-50"
              >
                {downloadingCsv ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                Download CSV
              </button>
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-500 italic py-16 text-center">No report data available.</p>
        )
      )}

      <style jsx>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  );
}
