'use client';

import { useEffect, useState } from 'react';
import { CalendarCheck, LayoutDashboard, X, IndianRupee } from 'lucide-react';
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
};

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [defaultRange] = useState(defaultDashboardRange);
  const [from, setFrom] = useState(defaultRange.from);
  const [to, setTo] = useState(defaultRange.to);

  useEffect(() => {
    async function fetchStats() {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (from) params.set('from', from);
        if (to) params.set('to', to);
        const response = await fetch(`/api/admin/stats?${params.toString()}`);
        if (response.ok) {
          const data = await response.json();
          setStats(data);
        }
      } catch (error) {
        console.error('Failed to fetch stats:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchStats();
  }, [from, to]);

  const revenueByCategoryData = (stats?.revenueBreakdown?.entries || [])
    .filter(entry => ['MACHINE', 'NET', 'SIDEARM', 'FULL_COURT'].includes(entry.key))
    .map(entry => ({
      name: CATEGORY_LABELS[entry.key] || entry.key,
      revenue: entry._sum.price || 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  const revenueByMachineData = (stats?.machineTypeRevenue || [])
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

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <AdminStatCard
          label="Total Bookings"
          value={stats?.totalBookings ?? 0}
          icon={CalendarCheck}
          href="/admin/bookings"
          gradient="bg-gradient-to-br from-blue-500/20 to-blue-500/5"
          iconColor="text-blue-400"
          loading={loading}
          delay={0}
        />
        <AdminStatCard
          label="Total Revenue"
          value={stats?.totalRevenue ? `₹${stats.totalRevenue.toLocaleString()}` : '₹0'}
          icon={IndianRupee}
          href="/admin/bookings"
          gradient="bg-gradient-to-br from-emerald-500/20 to-emerald-500/5"
          iconColor="text-emerald-400"
          isText
          loading={loading}
          delay={100}
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
                ['MACHINE', 'SIDEARM', 'NET', 'FULL_COURT'].map((cat) => (
                  <tr key={cat} className="animate-pulse">
                    <td className="px-4 py-4 border-r border-white/[0.07]"><div className="h-4 bg-white/10 rounded w-24" /></td>
                    <td className="px-4 py-4 border-r border-white/[0.07]"><div className="h-4 bg-white/10 rounded w-12 mx-auto" /></td>
                    <td className="px-4 py-4"><div className="h-4 bg-white/10 rounded w-12 mx-auto" /></td>
                  </tr>
                ))
              ) : stats?.bookingDistribution && stats.bookingDistribution.length > 0 ? (
                ['MACHINE', 'SIDEARM', 'NET', 'FULL_COURT'].map(cat => {
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
                  <td colSpan={3} className="px-4 py-10 text-center text-slate-500 italic">No data available for selected dates</td>
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
              <BarChart data={revenueByCategoryData} margin={{ top: 10, right: 10, left: 10, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                <XAxis 
                  dataKey="name" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
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
                  {revenueByCategoryData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-slate-500 italic">
              No revenue data available for selected dates
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
              <BarChart data={revenueByMachineData} margin={{ top: 10, right: 10, left: 10, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                <XAxis 
                  dataKey="name" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
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
                    <Cell key={`cell-${index}`} fill={CHART_COLORS[(index + 2) % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-slate-500 italic">
              No machine revenue data available for selected dates
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
