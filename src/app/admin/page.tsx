'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { CalendarCheck, Activity, UserPlus, CalendarDays, Settings, Clock, IndianRupee, TrendingUp, Zap, Wrench, CalendarPlus, LayoutDashboard, SlidersHorizontal } from 'lucide-react';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { AdminCard } from '@/components/admin/AdminCard';
import { AdminStatCard } from '@/components/admin/AdminStatCard';

interface Stats {
  totalBookings: number;
  activeAdmins: number;
  todayBookings: number;
  upcomingBookings: number;
  lastMonthBookings: number;
  totalRevenue: number;
  totalDiscount: number;
  systemStatus: string;
}

export default function AdminDashboard() {
  const { data: session } = useSession();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  const isSuperAdmin = session?.user?.email === 'waheeddar8@gmail.com';

  useEffect(() => {
    async function fetchStats() {
      try {
        const response = await fetch('/api/admin/stats');
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
  }, []);

  const statCards = [
    { label: 'Total Bookings', value: stats?.totalBookings ?? 0, icon: CalendarCheck, gradient: 'bg-gradient-to-br from-accent/15 to-accent/5', iconColor: 'text-accent', href: '/admin/bookings' },
    { label: 'Today', value: stats?.todayBookings ?? 0, icon: CalendarDays, gradient: 'bg-gradient-to-br from-orange-500/15 to-orange-500/5', iconColor: 'text-orange-400', href: '/admin/bookings?category=today' },
    { label: 'Upcoming', value: stats?.upcomingBookings ?? 0, icon: TrendingUp, gradient: 'bg-gradient-to-br from-blue-500/15 to-blue-500/5', iconColor: 'text-blue-400', href: '/admin/bookings?category=upcoming' },
    { label: 'Revenue', value: stats?.totalRevenue ? `₹${stats.totalRevenue.toLocaleString()}` : '₹0', icon: IndianRupee, gradient: 'bg-gradient-to-br from-emerald-500/15 to-emerald-500/5', iconColor: 'text-emerald-400', isText: true, prefix: '', href: '/admin/bookings' },
    { label: 'System Status', value: stats?.systemStatus ?? 'Healthy', icon: Activity, gradient: 'bg-gradient-to-br from-green-500/15 to-green-500/5', iconColor: 'text-green-400', isText: true, href: '/admin/policies' },
  ];

  const quickActions = [
    ...(isSuperAdmin ? [{ href: '/admin/users', label: 'Invite Admin', icon: UserPlus, variant: 'accent' as const }] : []),
    { href: '/admin/bookings', label: 'View Bookings', icon: CalendarDays, variant: 'default' as const },
    { href: '/admin/slots', label: 'Manage Slots', icon: Clock, variant: 'default' as const },
    { href: '/admin/configuration', label: 'Configuration', icon: SlidersHorizontal, variant: 'default' as const },
    { href: '/admin/policies', label: 'Policies', icon: Settings, variant: 'default' as const },
    ...(isSuperAdmin ? [{ href: '/admin/maintenance', label: 'Maintenance', icon: Wrench, variant: 'warning' as const }] : []),
  ];

  return (
    <div className="space-y-5">
      <AdminPageHeader
        icon={LayoutDashboard}
        title="Dashboard"
        description="Overview & quick actions"
      />

      {/* Welcome / Empty state banner */}
      {stats?.totalBookings === 0 && (
        <div className="animate-card-entrance bg-gradient-to-r from-accent/10 via-accent/5 to-transparent border border-accent/20 rounded-2xl p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-accent flex items-center justify-center shadow-lg shadow-accent/20">
              <CalendarPlus className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">No bookings yet!</p>
              <p className="text-xs text-slate-400 mt-0.5">Start by booking your first slot to see statistics.</p>
            </div>
          </div>
          <Link
            href="/slots"
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-accent hover:bg-accent-light text-primary rounded-xl text-sm font-semibold transition-colors shadow-sm"
          >
            Book Your First Slot
          </Link>
        </div>
      )}

      {/* ─── Stats Grid ───────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
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

      {/* ─── Quick Actions ────────────────────────── */}
      <AdminCard title="Quick Actions" icon={<Zap className="w-4 h-4 text-accent" />}>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {quickActions.map(action => (
            <Link
              key={action.href + action.label}
              href={action.href}
              className={`flex flex-col items-center gap-2 px-3 py-4 rounded-xl text-center transition-all duration-200 group ${action.variant === 'accent'
                  ? 'bg-accent/10 border border-accent/20 hover:bg-accent/20 hover:shadow-sm hover:shadow-accent/10'
                  : action.variant === 'warning'
                    ? 'bg-amber-500/8 border border-amber-500/15 hover:bg-amber-500/15'
                    : 'bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] hover:border-white/[0.12]'
                }`}
            >
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center transition-transform duration-200 group-hover:scale-110 ${action.variant === 'accent'
                  ? 'bg-accent/15'
                  : action.variant === 'warning'
                    ? 'bg-amber-500/15'
                    : 'bg-white/[0.06]'
                }`}>
                <action.icon className={`w-4 h-4 ${action.variant === 'accent'
                    ? 'text-accent'
                    : action.variant === 'warning'
                      ? 'text-amber-400'
                      : 'text-slate-400'
                  }`} />
              </div>
              <span className={`text-[11px] font-semibold ${action.variant === 'accent'
                  ? 'text-accent'
                  : action.variant === 'warning'
                    ? 'text-amber-300'
                    : 'text-slate-300'
                }`}>
                {action.label}
              </span>
            </Link>
          ))}
        </div>
      </AdminCard>
    </div>
  );
}
