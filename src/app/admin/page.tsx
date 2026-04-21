'use client';

import { useEffect, useState } from 'react';
import { CalendarCheck, Activity, CalendarDays, TrendingUp, IndianRupee, LayoutDashboard, X } from 'lucide-react';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { AdminStatCard } from '@/components/admin/AdminStatCard';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { MACHINES } from '@/lib/constants';

interface MachineRevenueItem {
  machineId: string;
  _sum: { price: number };
}

interface OperatorSummaryItem {
  id: string;
  name: string | null;
  bookings: number;
}

interface Stats {
  totalBookings: number;
  activeAdmins: number;
  todayBookings: number;
  upcomingBookings: number;
  lastMonthBookings: number;
  totalRevenue: number;
  bookingRevenue: number;
  packageRevenue: number;
  totalDiscount: number;
  machineRevenue: MachineRevenueItem[];
  selfOperatedBookings: number;
  unassignedBookings: number;
  operatorSummary: OperatorSummaryItem[];
  systemStatus: string;
}

const CHART_BAR_COLOR = '#38bdf8';

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

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

  const statCards = [
    { label: 'Total Bookings', value: stats?.totalBookings ?? 0, icon: CalendarCheck, gradient: 'bg-gradient-to-br from-accent/15 to-accent/5', iconColor: 'text-accent', href: '/admin/bookings' },
    { label: 'Today', value: stats?.todayBookings ?? 0, icon: CalendarDays, gradient: 'bg-gradient-to-br from-orange-500/15 to-orange-500/5', iconColor: 'text-orange-400', href: '/admin/bookings?category=today' },
    { label: 'Upcoming', value: stats?.upcomingBookings ?? 0, icon: TrendingUp, gradient: 'bg-gradient-to-br from-blue-500/15 to-blue-500/5', iconColor: 'text-blue-400', href: '/admin/bookings?category=upcoming' },
    { label: 'Revenue', value: stats?.totalRevenue ? `₹${stats.totalRevenue.toLocaleString()}` : '₹0', icon: IndianRupee, gradient: 'bg-gradient-to-br from-emerald-500/15 to-emerald-500/5', iconColor: 'text-emerald-400', isText: true, prefix: '', href: '/admin/bookings' },
    { label: 'Status', value: stats?.systemStatus ?? 'Healthy', icon: Activity, gradient: 'bg-gradient-to-br from-green-500/15 to-green-500/5', iconColor: 'text-green-400', isText: true, href: '/admin/policies' },
  ];

  const CHART_SHORT_NAMES: Record<string, string> = {
    GRAVITY: 'Gravity',
    YANTRA: 'Yantra',
    LEVERAGE_INDOOR: 'Tennis In',
    LEVERAGE_OUTDOOR: 'Tennis Out',
  };

  const machineChartData = (stats?.machineRevenue || [])
    .map(item => ({
      name: CHART_SHORT_NAMES[item.machineId] || MACHINES[item.machineId as keyof typeof MACHINES]?.shortName || item.machineId,
      revenue: item._sum.price || 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  const activeOperators = (stats?.operatorSummary || [])
    .filter(op => op.bookings > 0)
    .sort((a, b) => b.bookings - a.bookings);

  type DistributionRow = { key: string; label: string; value: number; color: string };
  const distributionRows: DistributionRow[] = [
    { key: 'self', label: 'Self-operated', value: stats?.selfOperatedBookings ?? 0, color: 'text-emerald-400' },
    { key: 'unassigned', label: 'Unassigned', value: stats?.unassignedBookings ?? 0, color: 'text-amber-400' },
    ...activeOperators.map(op => ({
      key: op.id,
      label: op.name || 'Unnamed',
      value: op.bookings,
      color: 'text-purple-400',
    })),
  ].sort((a, b) => b.value - a.value);

  return (
    <div className="space-y-5">
      <AdminPageHeader
        icon={LayoutDashboard}
        title="Dashboard"
        description="Overview & quick actions"
      />

      {/* Date Range Filter */}
      <div className="flex items-end gap-2 flex-wrap">
        <div className="grid grid-cols-2 gap-2 flex-1 min-w-0 max-w-sm">
          <div>
            <label className="block text-[11px] font-semibold text-slate-300 mb-1.5">From</label>
            <input
              type="date"
              value={from}
              onChange={e => setFrom(e.target.value)}
              className="w-full bg-white/[0.06] border border-white/[0.15] text-white rounded-lg px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 [color-scheme:dark]"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-300 mb-1.5">To</label>
            <input
              type="date"
              value={to}
              onChange={e => setTo(e.target.value)}
              className="w-full bg-white/[0.06] border border-white/[0.15] text-white rounded-lg px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 [color-scheme:dark]"
            />
          </div>
        </div>
        {(from || to) && (
          <button
            onClick={() => { setFrom(''); setTo(''); }}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors px-2 py-2.5 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
            Clear
          </button>
        )}
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
        {statCards.map((card, idx) => (
          <AdminStatCard
            key={card.label}
            label={card.label}
            value={card.isText ? (card.value as string) : (card.value as number)}
            icon={card.icon}
            href={card.href}
            gradient={card.gradient}
            iconColor={card.iconColor}
            loading={loading}
            isText={card.isText}
            prefix={card.prefix}
            delay={idx * 60}
          />
        ))}
      </div>

      {/* Revenue Breakdown */}
      {stats && (stats.bookingRevenue > 0 || stats.packageRevenue > 0) && (
        <div className="grid grid-cols-2 gap-2.5">
          <div className="bg-white/[0.03] backdrop-blur-sm rounded-xl border border-white/[0.07] p-3.5">
            <div className="text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-1">Booking Revenue</div>
            <div className="text-lg font-bold text-emerald-400">₹{stats.bookingRevenue.toLocaleString()}</div>
          </div>
          <div className="bg-white/[0.03] backdrop-blur-sm rounded-xl border border-white/[0.07] p-3.5">
            <div className="text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-1">Package Revenue</div>
            <div className="text-lg font-bold text-orange-400">₹{stats.packageRevenue.toLocaleString()}</div>
          </div>
        </div>
      )}

      {/* Machine-wise Revenue Chart */}
      <div className="bg-white/[0.03] backdrop-blur-sm rounded-xl sm:rounded-2xl border border-white/[0.07] p-4">
        <h2 className="text-sm font-semibold text-slate-400 mb-3 px-1">Revenue by Machine</h2>
        {!loading && machineChartData.length > 0 ? (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={machineChartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                <XAxis
                  dataKey="name"
                  tick={{ fill: '#cbd5e1', fontSize: 10, fontWeight: 500 }}
                  axisLine={false}
                  tickLine={false}
                  interval={0}
                />
                <YAxis
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={v => `₹${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  formatter={(value) => [`₹${Number(value).toLocaleString()}`, 'Revenue']}
                  contentStyle={{
                    backgroundColor: '#0f1d2f',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '8px',
                    color: '#e2e8f0',
                  }}
                  labelStyle={{ color: '#e2e8f0' }}
                  itemStyle={{ color: '#e2e8f0' }}
                  cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                />
                <Legend
                  wrapperStyle={{ color: '#94a3b8', fontSize: 12 }}
                  formatter={() => 'Revenue'}
                />
                <Bar dataKey="revenue" name="Revenue" fill={CHART_BAR_COLOR} radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : !loading ? (
          <p className="text-sm text-slate-500 text-center py-8">No machine revenue data available</p>
        ) : (
          <div className="h-64 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
          </div>
        )}
      </div>

      {/* Booking Distribution */}
      <div className="bg-white/[0.03] backdrop-blur-sm rounded-xl sm:rounded-2xl border border-white/[0.07] p-4">
        <h2 className="text-sm font-semibold text-slate-400 mb-3 px-1">Booking Distribution</h2>
        {!loading ? (
          <div className="space-y-2">
            {/* Total */}
            <div className="flex items-center justify-between py-2.5 px-3 bg-white/[0.06] rounded-lg border border-white/[0.08]">
              <span className="text-sm text-white font-semibold">Total Bookings</span>
              <span className="text-sm font-bold text-white">{stats?.totalBookings ?? 0}</span>
            </div>

            {/* Distribution rows sorted by count descending */}
            {distributionRows.map(row => (
              <div key={row.key} className="flex items-center justify-between py-2.5 px-3 bg-white/[0.03] rounded-lg border border-white/[0.06]">
                <span className="text-sm text-slate-300 font-medium">{row.label}</span>
                <span className={`text-sm font-bold ${row.color}`}>{row.value}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center py-8">
            <div className="w-6 h-6 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
          </div>
        )}
      </div>
    </div>
  );
}
