'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { LayoutDashboard, CalendarCheck, Users, Clock, Wrench, Package, Zap, SlidersHorizontal, ArrowLeft, Power, DatabaseZap, UserCog, Tag, Building2, AlertTriangle } from 'lucide-react';
import { signOut } from 'next-auth/react';
import { AdminMobileNav } from '@/components/admin/AdminMobileNav';
import { CenterSwitcher } from '@/components/admin/CenterSwitcher';
import { useCenter } from '@/lib/center-context';

const SUPER_ADMIN_EMAIL = 'waheeddar8@gmail.com';

type BookingModel = 'MACHINE_PITCH' | 'RESOURCE_BASED';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { currentCenter } = useCenter();
  // Source of truth for super admin is now the DB column, exposed on the
  // session as `user.isSuperAdmin`. Email match kept as a defensive fallback
  // so a stale token doesn't lock the project owner out of admin pages.
  const sessionUser = session?.user as {
    email?: string | null;
    role?: string;
    isSuperAdmin?: boolean;
  } | undefined;
  const isSuperAdmin = sessionUser?.isSuperAdmin === true || sessionUser?.email === SUPER_ADMIN_EMAIL;
  // Anyone past the middleware /admin/* gate has User.role = 'ADMIN' —
  // either as a super admin OR as a center-admin with a CenterMembership
  // somewhere.
  const isAdmin = sessionUser?.role === 'ADMIN';
  const isCenterAdmin = !isSuperAdmin && isAdmin && !!currentCenter;

  // We also allow Sidearm Specialists to access the /admin/sidearm page
  // so they can manage their own availability. The middleware is updated
  // to allow them into /admin, and we gate the links here.
  const hasSidearmMembership = currentCenter && sessionUser?.role === 'SIDEARM_SPECIALIST';
  const canAccessSidearmTab = isAdmin || hasSidearmMembership;
  // Personal Coaches get the same self-service access to /admin/coach,
  // mirroring the Sidearm tab exactly.
  const hasCoachMembership = currentCenter && sessionUser?.role === 'COACH';
  const canAccessCoachTab = isAdmin || hasCoachMembership;

  // Until we rebuild Slots/Operators/Offers/Packages for RESOURCE_BASED
  // centers (Toplay-style), the legacy forms hardcode the ABCA machine
  // enum and crash or silently no-op on resource centers. Hide those
  // links so admins don't land on broken pages. The `models` array is
  // the parity gate — leave it absent to show on every center.
  //
  // Each surface flips back on when its RESOURCE_BASED implementation
  // ships in this branch.
  const currentModel: BookingModel | null = currentCenter?.bookingModel ?? null;
  const links: Array<{ href: string; label: string; icon: typeof LayoutDashboard; models?: BookingModel[]; hidden?: boolean }> = [
    { href: '/admin', label: 'Dashboard', icon: LayoutDashboard, hidden: !isAdmin },
    { href: '/admin/bookings', label: 'Bookings', icon: CalendarCheck, hidden: !isAdmin },
    { href: '/admin/slots', label: 'Slots', icon: Clock, hidden: !isAdmin },
    { href: '/admin/users', label: 'Users', icon: Users, hidden: !isAdmin },
    { href: '/admin/operators', label: 'Operators', icon: UserCog, hidden: !isAdmin },
    // Sidearm tab — manages SIDEARM_SPECIALIST memberships and their
    // availability (recurring + date-range) plus priority order for
    // auto-assignment. Resource-based centers only; ABCA never had a
    // sidearm role wired into bookings.
    { href: '/admin/sidearm', label: 'Sidearm', icon: Users, models: ['RESOURCE_BASED'], hidden: !canAccessSidearmTab },
    // Personal Coach tab — manages COACH memberships and their
    // availability (recurring + date-range) plus priority order, exactly
    // like the Sidearm tab. Resource-based centers only.
    { href: '/admin/coach', label: 'Personal Coach', icon: UserCog, models: ['RESOURCE_BASED'], hidden: !canAccessCoachTab },
    { href: '/admin/offers', label: 'Offers', icon: Tag, hidden: !isAdmin },
    { href: '/admin/packages', label: 'Packages', icon: Package, hidden: !isAdmin },
    { href: '/admin/configuration', label: 'Settings', icon: SlidersHorizontal, hidden: !isAdmin },
    // /admin/policies removed — its raw key/value editor was confusing
    // and overlapped the structured forms here on Settings. Per-center
    // overrides for advanced keys still live under Centers → Policies.
    // User Mgmt is now visible to every admin (super OR center). The
    // API scopes the data to the current center for non-super admins
    // and gates destructive actions to super admins; center admins
    // primarily use it to view balances + credit/debit wallets.
    { href: '/admin/user-management', label: 'User Mgmt', icon: UserCog, hidden: !isAdmin },
    { href: `/admin/centers/${currentCenter?.id}`, label: 'My Center', icon: Building2, hidden: !isCenterAdmin },
    ...(isSuperAdmin
      ? [
          { href: '/admin/centers', label: 'Centers', icon: Building2 },
          { href: '/admin/payments/orphans', label: 'Orphan Payments', icon: AlertTriangle },
          { href: '/admin/maintenance', label: 'Maintenance', icon: Wrench },
          { href: '/admin/db-cleanup', label: 'DB Cleanup', icon: DatabaseZap },
        ]
      : []),
  ];

  // Filter by booking model. While the center is still loading
  // (`currentModel === null`), show every link so we don't briefly
  // render a stripped-down sidebar.
  const visibleLinks = links.filter(
    (l) => (!l.models || currentModel == null || l.models.includes(currentModel)) && !l.hidden,
  );

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
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-accent/20 to-purple-500/20 flex items-center justify-center flex-shrink-0">
            <Zap className="w-3 h-3 text-accent" />
          </div>
          <span className="text-xs font-bold text-white tracking-wide flex-shrink-0">Admin</span>
          {/* Center switcher — same component the desktop sidebar shows.
              Without it, mobile admins on a multi-center deployment had
              no way to change centers from inside /admin. */}
          <div className="ml-1 min-w-0">
            <CenterSwitcher compact />
          </div>
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
            <Power className="w-3 h-3" />
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

          {/* Center switcher (super admins + multi-center admins) */}
          <div className="px-3 pb-2">
            <CenterSwitcher />
          </div>

          {/* Nav Links */}
          <nav className="flex-1 px-3 py-2 space-y-0.5">
            {visibleLinks.map(({ href, label, icon: Icon }) => {
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
              <Power className="w-4 h-4" />
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
