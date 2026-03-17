'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { CalendarCheck, Activity, CalendarDays, Clock, IndianRupee, TrendingUp, LayoutDashboard, Wrench, SlidersHorizontal, Users, Package, Settings } from 'lucide-react';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
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
    { label: 'Status', value: stats?.systemStatus ?? 'Healthy', icon: Activity, gradient: 'bg-gradient-to-br from-green-500/15 to-green-500/5', iconColor: 'text-green-400', isText: true, href: '/admin/policies' },
  ];

  const manageLinks = [
    { href: '/admin/bookings', label: 'Bookings', icon: CalendarCheck, color: 'text-accent', bg: 'bg-accent/10' },
    { href: '/admin/slots', label: 'Slots', icon: Clock, color: 'text-blue-400', bg: 'bg-blue-500/10' },
    { href: '/admin/users', label: 'Users', icon: Users, color: 'text-purple-400', bg: 'bg-purple-500/10' },
    { href: '/admin/packages', label: 'Packages', icon: Package, color: 'text-orange-400', bg: 'bg-orange-500/10' },
    { href: '/admin/configuration', label: 'Settings', icon: SlidersHorizontal, color: 'text-slate-300', bg: 'bg-white/[0.06]' },
    { href: '/admin/policies', label: 'Policies', icon: Settings, color: 'text-slate-300', bg: 'bg-white/[0.06]' },
    ...(isSuperAdmin ? [{ href: '/admin/maintenance', label: 'Maintenance', icon: Wrench, color: 'text-amber-400', bg: 'bg-amber-500/10' }] : []),
  ];

  return (
    <div className="space-y-5">
      <AdminPageHeader
        icon={LayoutDashboard}
        title="Dashboard"
        description="Overview & quick actions"
      />

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

      {/* Quick Manage Grid - simple flat grid */}
      <div>
        <h2 className="text-sm font-semibold text-slate-400 mb-3 px-1">Manage</h2>
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          {manageLinks.map(({ href, label, icon: Icon, color, bg }) => (
            <Link
              key={href}
              href={href}
              className="flex flex-col items-center gap-1.5 px-2 py-3 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] hover:border-white/[0.12] transition-all active:scale-95 group"
            >
              <div className={`w-9 h-9 rounded-xl ${bg} flex items-center justify-center group-hover:scale-110 transition-transform`}>
                <Icon className={`w-4 h-4 ${color}`} />
              </div>
              <span className="text-[10px] font-medium text-slate-300">{label}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
