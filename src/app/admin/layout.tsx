'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { LayoutDashboard, CalendarCheck, Users, Settings, Clock, Wrench, Package, Zap, SlidersHorizontal, ArrowLeft, LogOut } from 'lucide-react';
import { signOut } from 'next-auth/react';
import { AdminMobileNav } from '@/components/admin/AdminMobileNav';

const SUPER_ADMIN_EMAIL = 'waheeddar8@gmail.com';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const isSuperAdmin = session?.user?.email === SUPER_ADMIN_EMAIL;

  const links = [
    { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/admin/bookings', label: 'Bookings', icon: CalendarCheck },
    { href: '/admin/slots', label: 'Slots', icon: Clock },
    { href: '/admin/users', label: 'Users', icon: Users },
    { href: '/admin/packages', label: 'Packages', icon: Package },
    { href: '/admin/configuration', label: 'Settings', icon: SlidersHorizontal },
    { href: '/admin/policies', label: 'Policies', icon: Settings },
    ...(isSuperAdmin ? [{ href: '/admin/maintenance', label: 'Maintenance', icon: Wrench }] : []),
  ];

  const isActive = (href: string) =>
    href === '/admin' ? pathname === '/admin' : pathname.startsWith(href);

  return (
    <div className="min-h-[calc(100vh-56px)] overflow-x-hidden">
      {/* Background gradient */}
      <div className="fixed inset-0 -z-10 bg-gradient-to-br from-[#0a1628] via-[#0f1d35] to-[#0d1f3c]"></div>
      <div className="fixed inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,rgba(56,189,248,0.04),transparent_60%)]"></div>
      <div className="fixed inset-0 -z-10 bg-[radial-gradient(ellipse_at_bottom_right,rgba(139,92,246,0.03),transparent_60%)]"></div>

      {/* Mobile: Compact header */}
      <div className="md:hidden flex items-center justify-between px-4 py-2 bg-[#0b1726]/80 backdrop-blur-xl border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-accent/20 to-purple-500/20 flex items-center justify-center">
            <Zap className="w-3 h-3 text-accent" />
          </div>
          <span className="text-xs font-bold text-white tracking-wide">Admin</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Link
            href="/slots"
            className="flex items-center gap-1.5 text-slate-400 hover:text-white transition-colors text-xs font-medium px-2.5 py-1.5 rounded-lg bg-white/[0.04] active:scale-95"
          >
            <ArrowLeft className="w-3 h-3" />
            User Mode
          </Link>
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="flex items-center gap-1.5 text-red-400/70 hover:text-red-400 transition-colors text-xs font-medium px-2.5 py-1.5 rounded-lg bg-white/[0.04] active:scale-95 cursor-pointer"
          >
            <LogOut className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Admin Mobile Bottom Navigation */}
      <AdminMobileNav />

      <div className="flex">
        {/* Desktop: Sidebar */}
        <aside className="hidden md:flex md:flex-col w-56 bg-[#0b1726]/80 backdrop-blur-xl border-r border-white/[0.06] min-h-[calc(100vh-64px)]">
          {/* Sidebar Header */}
          <div className="px-5 pt-5 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-accent/20 to-purple-500/20 flex items-center justify-center">
                <Zap className="w-4 h-4 text-accent" />
              </div>
              <div>
                <h2 className="text-[11px] font-bold text-white tracking-wide">Admin Panel</h2>
                <p className="text-[9px] text-slate-600 font-medium">PlayOrbit</p>
              </div>
            </div>
          </div>

          {/* Nav Links */}
          <nav className="flex-1 px-3 py-2 space-y-0.5">
            {links.map(({ href, label, icon: Icon }) => {
              const active = isActive(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={`relative flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group ${active
                    ? 'bg-accent/10 text-accent'
                    : 'text-slate-500 hover:bg-white/[0.04] hover:text-slate-300'
                    }`}
                >
                  {/* Active indicator bar */}
                  {active && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-accent rounded-r-full" />
                  )}
                  <Icon className={`w-[18px] h-[18px] transition-transform duration-200 ${active ? '' : 'group-hover:scale-110'}`} />
                  {label}
                </Link>
              );
            })}
          </nav>

          {/* Sidebar Footer */}
          <div className="px-3 py-3 border-t border-white/[0.04] space-y-1.5">
            <Link
              href="/slots"
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all text-slate-500 hover:bg-white/[0.04] hover:text-slate-300"
            >
              <ArrowLeft className="w-4 h-4" />
              User Mode
            </Link>
            <button
              onClick={() => signOut({ callbackUrl: '/login' })}
              className="flex items-center gap-2 w-full px-3 py-2 rounded-xl text-sm font-medium transition-all cursor-pointer text-red-400/70 hover:bg-white/[0.04] hover:text-red-400"
            >
              <LogOut className="w-4 h-4" />
              Logout
            </button>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 min-w-0 p-4 pb-20 md:p-6 md:pb-6">
          <div className="max-w-5xl mx-auto overflow-x-hidden">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
