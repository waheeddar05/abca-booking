'use client';

import { useEffect, useState } from 'react';
import { CalendarCheck, LayoutDashboard, X, IndianRupee, AlertCircle } from 'lucide-react';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { AdminStatCard } from '@/components/admin/AdminStatCard';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid } from 'recharts';

interface BookingDistributionItem {
  category: string;
  today: number;
  upcoming: number;
}

interface RevenueItem {
  name: string;
  revenue: number;
}

interface StaffSessionItem {
  id: string;
  name: string;
  sessions: number;
}

interface Stats {
  totalBookings: number;
  totalRevenue: number;
  bookingRevenue: number;
  packageRevenue: number;
  bookingDistribution: BookingDistributionItem[];
  revenueBreakdown: {
    entries: Array<{
      key: string;
      _sum: { price: number };
    }>;
  };
  machineTypeRevenue: RevenueItem[];
  operatorSummary: StaffSessionItem[];
  sidearmSummary: StaffSessionItem[];
  coachSummary: StaffSessionItem[];
}

const CHART_COLORS = ['#38bdf8', '#818cf8', '#fb7185', '#34d399', '#fbbf24', '#a78bfa'];

function istYMD(d: Date): string {
  const ist = new Date(d.getTime() + (5 * 60 + 30) * 60 * 1000);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const day = String(ist.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function defaultDashboardRange(): { from: string; to: string } {
  const now = new Date();
  const ist = new Date(now.getTime() + (5 * 60 + 30) * 60 * 1000);
  const firstOfMonth = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1));
  return { from: istYMD(firstOfMonth), to: istYMD(now) };
}

const CATEGORY_LABELS: Record<string, string> = {
  MACHINE: 'Bowling Machine',
  SIDEARM: 'Sidearm',
  NET: 'Cricket Net',
  FULL_COURT: 'Full Indoor Court',
  COACHING: 'Personal Coaching',
  CORPORATE_BATCH: 'Corporate Batch',
  MATCH_SIMULATION: 'Match Simulation',
};

// Categories shown on the Booking Distribution table + Revenue by
// Category chart. Match Practice categories included so corporate-batch
// enrollments and match-simulation seats show up in counts and revenue.
const DASHBOARD_CATEGORIES = [
  'MACHINE', 'SIDEARM', 'COACHING', 'NET', 'FULL_COURT', 'CORPORATE_BATCH', 'MATCH_SIMULATION',
];

interface AxisTickProps {
  x?: number;
  y?: number;
  payload?: { value?: string | number };
}

// X-axis tick that wraps multi-word labels onto separate lines, so the name
// sits directly under its bar and stays readable on narrow mobile columns
// (e.g. "Full Indoor Court" stacks into three lines instead of overflowing).
function WrappedAxisTick({ x = 0, y = 0, payload }: AxisTickProps) {
  const words = String(payload?.value ?? '').split(' ');
  return (
    <g transform={`translate(${x},${y})`}>
      <text textAnchor="middle" fill="#94a3b8" fontSize={10}>
        {words.map((word, i) => (
          <tspan key={i} x={0} dy={i === 0 ? 12 : 11}>
            {word}
          </tspan>
        ))}
      </text>
    </g>
  );
}

// Coerce any value coming back from the API into a finite number. Recharts
// throws if it is handed NaN/Infinity/undefined, which would otherwise bubble
// up to the route error boundary ("Something went wrong"). This keeps a valid
// date selection from ever crashing the dashboard.
function safeNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [defaultRange] = useState(defaultDashboardRange);
  const [from, setFrom] = useState(defaultRange.from);
  const [to, setTo] = useState(defaultRange.to);
  // Bumped by the Retry button to re-run the fetch without changing the range.
  const [reloadKey, setReloadKey] = useState(0);

  // Guard against an inverted range on the client so we never fire a request
  // that can only come back empty. (The API also swaps it defensively.)
  const invalidRange = Boolean(from && to && from > to);

  useEffect(() => {
    if (invalidRange) {
      setError('Start date must be on or before the end date.');
      setLoading(false);
      return;
    }

    const controller = new AbortController();

    async function fetchStats() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (from) params.set('from', from);
        if (to) params.set('to', to);
        const response = await fetch(`/api/admin/stats?${params.toString()}`, {
          signal: controller.signal,
        });
        if (response.ok) {
          const data = await response.json();
          setStats(data);
        } else {
          // Surface a friendly, non-generic message and clear stale data so
          // the empty states read correctly instead of showing old numbers.
          let message = 'Unable to load dashboard data. Please try again.';
          try {
            const body = await response.json();
            if (body?.error && typeof body.error === 'string') message = body.error;
          } catch {
            /* response had no JSON body */
          }
          console.error('Failed to fetch stats:', response.status, message);
          setStats(null);
          setError(message);
        }
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        console.error('Failed to fetch stats:', err);
        setStats(null);
        setError('Unable to load dashboard data. Please check your connection and try again.');
      } finally {
        setLoading(false);
      }
    }

    fetchStats();
    return () => controller.abort();
  }, [from, to, invalidRange, reloadKey]);

  const revenueByCategoryData = (stats?.revenueBreakdown?.entries || [])
    .filter(entry => entry && DASHBOARD_CATEGORIES.includes(entry.key))
    .map(entry => ({
      name: CATEGORY_LABELS[entry.key] || entry.key,
      revenue: safeNumber(entry?._sum?.price),
    }))
    .sort((a, b) => b.revenue - a.revenue);

  const revenueByMachineData = (stats?.machineTypeRevenue || [])
    .map(item => ({ name: item?.name ?? '—', revenue: safeNumber(item?.revenue) }))
    .sort((a, b) => b.revenue - a.revenue);

  return (
    <div className="space-y-6 pb-10">
      <AdminPageHeader
        icon={LayoutDashboard}
        title="Admin Dashboard"
        description="Business metrics & performance"
      />

      {/* Global Date Filter Section */}
      <div className="bg-white/[0.03] backdrop-blur-sm rounded-xl border border-white/[0.07] p-4">
        <div className="flex flex-col sm:flex-row items-end gap-4">
          <div className="grid grid-cols-2 gap-4 flex-1 w-full max-w-md">
            <div>
              <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 ml-1">From Date</label>
              <input
                type="date"
                value={from}
                onChange={e => setFrom(e.target.value)}
                className="w-full bg-slate-900/50 border border-white/[0.1] text-white rounded-lg px-3 py-2 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 [color-scheme:dark]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 ml-1">To Date</label>
              <input
                type="date"
                value={to}
                onChange={e => setTo(e.target.value)}
                className="w-full bg-slate-900/50 border border-white/[0.1] text-white rounded-lg px-3 py-2 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 [color-scheme:dark]"
              />
            </div>
          </div>
          {(from !== defaultRange.from || to !== defaultRange.to) && (
            <button
              onClick={() => { setFrom(defaultRange.from); setTo(defaultRange.to); }}
              className="flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-white transition-colors px-3 py-2 bg-white/[0.05] rounded-lg border border-white/[0.05] mb-0.5"
            >
              <X className="w-3.5 h-3.5" />
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Error banner — shown for failed loads or an invalid range, so a date
          selection never silently breaks the dashboard or shows a generic crash. */}
      {error && !loading && (
        <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/20 text-red-200 rounded-xl px-4 py-3 text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-400" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-red-300">Couldn&apos;t load dashboard data</p>
            <p className="text-red-200/80 break-words">{error}</p>
          </div>
          {!invalidRange && (
            <button
              onClick={() => setReloadKey(k => k + 1)}
              className="shrink-0 self-center text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-500/15 hover:bg-red-500/25 transition-colors"
            >
              Retry
            </button>
          )}
        </div>
      )}

      {/* KPI Summary Cards — always one row (3 across), tightened on small screens */}
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <AdminStatCard
          label="Total Revenue"
          value={stats?.totalRevenue ? `₹${stats.totalRevenue.toLocaleString()}` : '₹0'}
          icon={IndianRupee}
          href="/admin/bookings"
          gradient="bg-gradient-to-br from-emerald-500/20 to-emerald-500/5"
          iconColor="text-emerald-400"
          isText
          loading={loading}
          delay={0}
        />
        <AdminStatCard
          label="Bookings Revenue"
          value={stats?.bookingRevenue ? `₹${stats.bookingRevenue.toLocaleString()}` : '₹0'}
          icon={CalendarCheck}
          href="/admin/bookings"
          gradient="bg-gradient-to-br from-blue-500/20 to-blue-500/5"
          iconColor="text-blue-400"
          isText
          loading={loading}
          delay={100}
        />
        <AdminStatCard
          label="Package Revenue"
          value={stats?.packageRevenue ? `₹${stats.packageRevenue.toLocaleString()}` : '₹0'}
          icon={IndianRupee}
          href="/admin/packages"
          gradient="bg-gradient-to-br from-amber-500/20 to-amber-500/5"
          iconColor="text-amber-400"
          isText
          loading={loading}
          delay={200}
        />
      </div>

      {/* Booking Distribution Table */}
      <div className="bg-white/[0.03] backdrop-blur-sm rounded-xl border border-white/[0.07] overflow-hidden">
        <div className="px-4 py-3 border-b border-white/[0.07]">
          <h2 className="text-sm font-bold text-white uppercase tracking-wider">Booking Distribution</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left border-collapse">
            <thead>
              <tr className="bg-white/[0.02]">
                <th className="px-4 py-3 font-semibold text-slate-400 border-b border-white/[0.07] border-r border-white/[0.07]">Category</th>
                <th className="px-4 py-3 font-semibold text-slate-400 border-b border-white/[0.07] text-center border-r border-white/[0.07]">Today</th>
                <th className="px-4 py-3 font-semibold text-slate-400 border-b border-white/[0.07] text-center">Upcoming</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05]">
              {loading ? (
                DASHBOARD_CATEGORIES.map((cat) => (
                  <tr key={cat} className="animate-pulse">
                    <td className="px-4 py-4 border-r border-white/[0.07]"><div className="h-4 bg-white/10 rounded w-24" /></td>
                    <td className="px-4 py-4 border-r border-white/[0.07]"><div className="h-4 bg-white/10 rounded w-12 mx-auto" /></td>
                    <td className="px-4 py-4"><div className="h-4 bg-white/10 rounded w-12 mx-auto" /></td>
                  </tr>
                ))
              ) : stats?.bookingDistribution && stats.bookingDistribution.length > 0 ? (
                DASHBOARD_CATEGORIES.map(cat => {
                  const item = stats.bookingDistribution.find(d => d.category === cat) || { category: cat, today: 0, upcoming: 0 };
                  return (
                    <tr key={cat} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3.5 font-medium text-slate-200 border-r border-white/[0.07]">{CATEGORY_LABELS[cat] || cat}</td>
                      <td className="px-4 py-3.5 text-center text-slate-300 border-r border-white/[0.07]">{item.today}</td>
                      <td className="px-4 py-3.5 text-center text-slate-300">{item.upcoming}</td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={3} className="px-4 py-10 text-center text-slate-500 italic">No data available for the selected date range.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Revenue by Category Chart */}
      <div className="bg-white/[0.03] backdrop-blur-sm rounded-xl border border-white/[0.07] p-5">
        <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-6">Revenue by Category</h2>
        <div className="h-72 w-full">
          {loading ? (
            <div className="h-full w-full bg-white/[0.03] rounded-lg animate-pulse flex items-center justify-center">
              <div className="w-8 h-8 border-2 border-accent/20 border-t-accent rounded-full animate-spin" />
            </div>
          ) : revenueByCategoryData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={revenueByCategoryData} margin={{ top: 10, right: 10, left: 10, bottom: 28 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                <XAxis
                  dataKey="name"
                  axisLine={false}
                  tickLine={false}
                  tick={<WrappedAxisTick />}
                  interval={0}
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#64748b', fontSize: 10 }}
                  tickFormatter={(v) => `₹${v >= 1000 ? (v/1000).toFixed(0) + 'k' : v}`}
                />
                <Tooltip 
                  cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                  contentStyle={{ backgroundColor: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                  itemStyle={{ color: '#fff', fontSize: '12px' }}
                  labelStyle={{ color: '#94a3b8', fontSize: '11px', marginBottom: '4px' }}
                  formatter={(value: any) => [`₹${value.toLocaleString()}`, 'Revenue']}
                />
                <Bar dataKey="revenue" radius={[4, 4, 0, 0]} barSize={40} name="Revenue">
                  {revenueByCategoryData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-slate-500 italic">
              No data available for the selected date range.
            </div>
          )}
        </div>
      </div>

      {/* Revenue by Bowling Machine Type Chart */}
      <div className="bg-white/[0.03] backdrop-blur-sm rounded-xl border border-white/[0.07] p-5">
        <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-6">Revenue by Bowling Machine Type</h2>
        <div className="h-72 w-full">
          {loading ? (
            <div className="h-full w-full bg-white/[0.03] rounded-lg animate-pulse flex items-center justify-center">
              <div className="w-8 h-8 border-2 border-accent/20 border-t-accent rounded-full animate-spin" />
            </div>
          ) : revenueByMachineData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={revenueByMachineData} margin={{ top: 10, right: 10, left: 10, bottom: 28 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                <XAxis
                  dataKey="name"
                  axisLine={false}
                  tickLine={false}
                  tick={<WrappedAxisTick />}
                  interval={0}
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#64748b', fontSize: 10 }}
                  tickFormatter={(v) => `₹${v >= 1000 ? (v/1000).toFixed(0) + 'k' : v}`}
                />
                <Tooltip 
                  cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                  contentStyle={{ backgroundColor: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                  itemStyle={{ color: '#fff', fontSize: '12px' }}
                  labelStyle={{ color: '#94a3b8', fontSize: '11px', marginBottom: '4px' }}
                  formatter={(value: any) => [`₹${value.toLocaleString()}`, 'Revenue']}
                />
                <Bar dataKey="revenue" radius={[4, 4, 0, 0]} barSize={40}>
                  {revenueByMachineData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={CHART_COLORS[0]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-slate-500 italic">
              No data available for the selected date range.
            </div>
          )}
        </div>
      </div>

      {/* Staff Session Distribution Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Table A — Operators */}
        <div className="bg-white/[0.03] backdrop-blur-sm rounded-xl border border-white/[0.07] overflow-hidden h-fit">
          <div className="px-4 py-3 bg-white/[0.02] border-b border-white/[0.07]">
            <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Operator Sessions</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="text-[10px] text-slate-500 uppercase">
                  <th className="px-4 py-2 font-bold border-b border-white/[0.05]">Operator Name</th>
                  <th className="px-4 py-2 font-bold border-b border-white/[0.05] text-right">Sessions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {loading ? (
                  [...Array(3)].map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      <td className="px-4 py-3"><div className="h-3 bg-white/10 rounded w-20" /></td>
                      <td className="px-4 py-3 text-right"><div className="h-3 bg-white/10 rounded w-6 ml-auto" /></td>
                    </tr>
                  ))
                ) : stats?.operatorSummary && stats.operatorSummary.length > 0 ? (
                  stats.operatorSummary.map(op => (
                    <tr key={op.id} className="hover:bg-white/[0.02]">
                      <td className="px-4 py-3 text-slate-300 truncate max-w-[140px]">{op.name}</td>
                      <td className="px-4 py-3 text-right font-bold text-white">{op.sessions}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={2} className="px-4 py-6 text-center text-slate-500 text-xs italic">No operator data</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Table B — Sidearm */}
        <div className="bg-white/[0.03] backdrop-blur-sm rounded-xl border border-white/[0.07] overflow-hidden h-fit">
          <div className="px-4 py-3 bg-white/[0.02] border-b border-white/[0.07]">
            <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Sidearm Sessions</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="text-[10px] text-slate-500 uppercase">
                  <th className="px-4 py-2 font-bold border-b border-white/[0.05]">Specialist Name</th>
                  <th className="px-4 py-2 font-bold border-b border-white/[0.05] text-right">Sessions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {loading ? (
                  [...Array(3)].map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      <td className="px-4 py-3"><div className="h-3 bg-white/10 rounded w-20" /></td>
                      <td className="px-4 py-3 text-right"><div className="h-3 bg-white/10 rounded w-6 ml-auto" /></td>
                    </tr>
                  ))
                ) : stats?.sidearmSummary && stats.sidearmSummary.length > 0 ? (
                  stats.sidearmSummary.map(sp => (
                    <tr key={sp.id} className="hover:bg-white/[0.02]">
                      <td className="px-4 py-3 text-slate-300 truncate max-w-[140px]">{sp.name}</td>
                      <td className="px-4 py-3 text-right font-bold text-white">{sp.sessions}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={2} className="px-4 py-6 text-center text-slate-500 text-xs italic">No sidearm data</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Table C — Coaches */}
        <div className="bg-white/[0.03] backdrop-blur-sm rounded-xl border border-white/[0.07] overflow-hidden h-fit">
          <div className="px-4 py-3 bg-white/[0.02] border-b border-white/[0.07]">
            <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Personal Coach Sessions</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="text-[10px] text-slate-500 uppercase">
                  <th className="px-4 py-2 font-bold border-b border-white/[0.05]">Coach Name</th>
                  <th className="px-4 py-2 font-bold border-b border-white/[0.05] text-right">Sessions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {loading ? (
                  [...Array(3)].map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      <td className="px-4 py-3"><div className="h-3 bg-white/10 rounded w-20" /></td>
                      <td className="px-4 py-3 text-right"><div className="h-3 bg-white/10 rounded w-6 ml-auto" /></td>
                    </tr>
                  ))
                ) : stats?.coachSummary && stats.coachSummary.length > 0 ? (
                  stats.coachSummary.map(ch => (
                    <tr key={ch.id} className="hover:bg-white/[0.02]">
                      <td className="px-4 py-3 text-slate-300 truncate max-w-[140px]">{ch.name}</td>
                      <td className="px-4 py-3 text-right font-bold text-white">{ch.sessions}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={2} className="px-4 py-6 text-center text-slate-500 text-xs italic">No coaching data</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
