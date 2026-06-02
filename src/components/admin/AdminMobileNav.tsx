'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { LayoutDashboard, CalendarCheck, Clock, Users, UserCog, SlidersHorizontal, Package, Tag, Building2 } from 'lucide-react';
import { useCenter } from '@/lib/center-context';

type BookingModel = 'MACHINE_PITCH' | 'RESOURCE_BASED';

const SUPER_ADMIN_EMAIL = 'waheeddar8@gmail.com';

export function AdminMobileNav() {
    const pathname = usePathname();
    const { currentCenter } = useCenter();
    const { data: session } = useSession();
    const currentModel: BookingModel | null = currentCenter?.bookingModel ?? null;

    // Role gating mirrors the desktop sidebar so a center admin on a
    // phone gets the same surfaces (My Center, etc.) as on desktop.
    const sessionUser = session?.user as
      | { email?: string | null; role?: string; isSuperAdmin?: boolean }
      | undefined;
    const isSuperAdmin =
      sessionUser?.isSuperAdmin === true || sessionUser?.email === SUPER_ADMIN_EMAIL;
    const isAdmin = sessionUser?.role === 'ADMIN';
    const isCenterAdmin =
      !isSuperAdmin && isAdmin && !!currentCenter;

    // We also allow Sidearm Specialists to access the /admin/sidearm page
    // so they can manage their own availability.
    const hasSidearmMembership = currentCenter && sessionUser?.role === 'SIDEARM_SPECIALIST';
    const canAccessSidearmTab = isAdmin || hasSidearmMembership;
    // Personal Coaches get the same self-service access to /admin/coach.
    const hasCoachMembership = currentCenter && sessionUser?.role === 'COACH';
    const canAccessCoachTab = isAdmin || hasCoachMembership;

    // Same parity gating as the desktop sidebar: legacy ABCA-only forms
    // hide on RESOURCE_BASED centers until their resource-aware versions
    // ship in this branch.
    const tabs: Array<{ href: string; label: string; icon: typeof LayoutDashboard; models?: BookingModel[]; hidden?: boolean }> = [
        { href: '/admin', label: 'Home', icon: LayoutDashboard, hidden: !isAdmin },
        { href: '/admin/bookings', label: 'Bookings', icon: CalendarCheck, hidden: !isAdmin },
        { href: '/admin/slots', label: 'Slots', icon: Clock, hidden: !isAdmin },
        { href: '/admin/users', label: 'Users', icon: Users, hidden: !isAdmin },
        { href: '/admin/operators', label: 'Operators', icon: UserCog, hidden: !isAdmin },
        { href: '/admin/sidearm', label: 'Sidearm', icon: Users, models: ['RESOURCE_BASED'], hidden: !canAccessSidearmTab },
        // Short "Coach" label keeps the bottom-nav cell tidy on phones;
        // the page itself is titled "Personal Coach".
        { href: '/admin/coach', label: 'Coach', icon: UserCog, models: ['RESOURCE_BASED'], hidden: !canAccessCoachTab },
        { href: '/admin/packages', label: 'Packages', icon: Package, hidden: !isAdmin },
        { href: '/admin/offers', label: 'Offers', icon: Tag, hidden: !isAdmin },
        { href: '/admin/configuration', label: 'Settings', icon: SlidersHorizontal, hidden: !isAdmin },
        // Super admin → cross-center management. Center admin → deep
        // link to their own center's edit page (members / machines /
        // resources / policies tabs). Hidden for everyone else.
        ...(isSuperAdmin
          ? [{ href: '/admin/centers', label: 'Centers', icon: Building2 }]
          : isCenterAdmin
          ? [{ href: `/admin/centers/${currentCenter?.id}`, label: 'My Center', icon: Building2 }]
          : []),
    ];

    const visibleTabs = tabs.filter(
        (t) => (!t.models || currentModel == null || t.models.includes(currentModel)) && !t.hidden,
    );

    const isActive = (href: string) => {
        if (href === '/admin') return pathname === '/admin';
        // Configuration tab also highlights for policies
        if (href === '/admin/configuration') return pathname.startsWith('/admin/configuration') || pathname.startsWith('/admin/policies');
        return pathname.startsWith(href);
    };

    return (
        <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden">
            <div className="bg-[#0b1726]/95 backdrop-blur-xl border-t border-white/[0.08] pb-safe">
                <div className="flex overflow-x-auto h-[60px] scrollbar-hide">
                    {visibleTabs.map((tab) => {
                        const active = isActive(tab.href);
                        return (
                            <Link
                                key={tab.href}
                                href={tab.href}
                                className={`flex flex-col items-center justify-center h-full relative transition-colors min-w-[3.25rem] flex-1 ${active ? 'text-accent' : 'text-slate-500 active:text-slate-300'
                                    }`}
                            >
                                {active && (
                                    <div className="absolute top-0 w-8 h-[2px] rounded-b-full bg-accent/80" />
                                )}
                                <tab.icon className={`w-5 h-5 mb-0.5 ${active ? 'scale-105' : ''} transition-transform`} />
                                <span className={`text-[9px] font-medium leading-tight ${active ? 'text-accent' : ''}`}>
                                    {tab.label}
                                </span>
                            </Link>
                        );
                    })}
                </div>
            </div>
        </nav>
    );
}
