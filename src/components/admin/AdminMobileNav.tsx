'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, CalendarCheck, Clock, Users, UserCog, SlidersHorizontal, Package, Tag } from 'lucide-react';
import { useCenter } from '@/lib/center-context';

type BookingModel = 'MACHINE_PITCH' | 'RESOURCE_BASED';

export function AdminMobileNav() {
    const pathname = usePathname();
    const { currentCenter } = useCenter();
    const currentModel: BookingModel | null = currentCenter?.bookingModel ?? null;

    // Same parity gating as the desktop sidebar: legacy ABCA-only forms
    // hide on RESOURCE_BASED centers until their resource-aware versions
    // ship in this branch.
    const tabs: Array<{ href: string; label: string; icon: typeof LayoutDashboard; models?: BookingModel[] }> = [
        { href: '/admin', label: 'Home', icon: LayoutDashboard },
        { href: '/admin/bookings', label: 'Bookings', icon: CalendarCheck },
        { href: '/admin/slots', label: 'Slots', icon: Clock },
        { href: '/admin/users', label: 'Users', icon: Users },
        { href: '/admin/operators', label: 'Operators', icon: UserCog },
        { href: '/admin/packages', label: 'Packages', icon: Package, models: ['MACHINE_PITCH'] },
        { href: '/admin/offers', label: 'Offers', icon: Tag, models: ['MACHINE_PITCH'] },
        { href: '/admin/configuration', label: 'Settings', icon: SlidersHorizontal },
    ];

    const visibleTabs = tabs.filter(
        (t) => !t.models || currentModel == null || t.models.includes(currentModel),
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
