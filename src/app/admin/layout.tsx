'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, CalendarCheck, Users, Settings, Clock } from 'lucide-react';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  const links = [
    { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/admin/bookings', label: 'Bookings', icon: CalendarCheck },
    { href: '/admin/slots', label: 'Slots', icon: Clock },
    { href: '/admin/users', label: 'Users', icon: Users },
    { href: '/admin/policies', label: 'Policies', icon: Settings },
  ];

  const isActive = (href: string) =>
    href === '/admin' ? pathname === '/admin' : pathname.startsWith(href);

  return (
    <div className="min-h-[calc(100vh-56px)]">
      {/* Background gradient */}
      <div className="fixed inset-0 -z-10 bg-gradient-to-br from-[#0a1628] via-[#132240] to-[#0d1f3c]"></div>
      <div className="fixed inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,rgba(212,168,67,0.05),transparent_60%)]"></div>

      {/* Mobile: Horizontal tabs */}
      <div className="md:hidden sticky top-14 z-30 bg-[#0f1d2f]/95 backdrop-blur-md border-b border-white/[0.06]">
        <div className="flex overflow-x-auto px-2 py-1 gap-1">
          {links.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                isActive(href)
                  ? 'bg-accent/15 text-accent'
                  : 'text-slate-400 hover:bg-white/[0.04]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </Link>
          ))}
        </div>
      </div>

      <div className="flex">
        {/* Desktop: Sidebar */}
        <aside className="hidden md:block w-56 bg-[#0f1d2f]/60 backdrop-blur-sm border-r border-white/[0.06] min-h-[calc(100vh-64px)] p-4">
          <h2 className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-3 px-3">
            Admin Panel
          </h2>
          <nav className="space-y-0.5">
            {links.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  isActive(href)
                    ? 'bg-accent/15 text-accent'
                    : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </Link>
            ))}
          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-4 md:p-6">
          <div className="max-w-5xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
