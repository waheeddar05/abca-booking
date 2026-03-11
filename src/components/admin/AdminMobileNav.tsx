'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, CalendarCheck, Clock, Menu, Home } from 'lucide-react';
import { useState } from 'react';
import { AdminMobileMenu } from './AdminMobileMenu';

export function AdminMobileNav() {
    const pathname = usePathname();
    const [isMenuOpen, setIsMenuOpen] = useState(false);

    const tabs = [
        { href: '/slots', label: 'App', icon: Home },
        { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
        { href: '/admin/bookings', label: 'Bookings', icon: CalendarCheck },
        { href: '/admin/slots', label: 'Slots', icon: Clock },
        { href: '#', label: 'More', icon: Menu, isMenu: true },
    ];

    const isActive = (href: string) => {
        if (href === '/admin') return pathname === '/admin';
        if (href === '#' || href === '/slots') return false;
        return pathname.startsWith(href);
    };

    return (
        <>
            <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden animate-fade-in">
                <div className="bg-[#0b1726]/95 backdrop-blur-xl border-t border-white/[0.08] pb-safe">
                    <div className="flex items-center justify-around h-[65px]">
                        {tabs.map((tab) => {
                            const active = isActive(tab.href);

                            if (tab.isMenu) {
                                return (
                                    <button
                                        key="menu"
                                        onClick={() => setIsMenuOpen(true)}
                                        className="flex flex-col items-center justify-center flex-1 h-full relative transition-colors text-slate-400 hover:text-white"
                                    >
                                        <tab.icon className="w-[22px] h-[22px] mb-1" />
                                        <span className="text-[10px] font-medium">{tab.label}</span>
                                    </button>
                                );
                            }

                            return (
                                <Link
                                    key={tab.href}
                                    href={tab.href}
                                    className={`flex flex-col items-center justify-center flex-1 h-full relative transition-colors ${active ? 'text-accent' : 'text-slate-400 hover:text-slate-300'
                                        }`}
                                >
                                    {active && (
                                        <div className="absolute top-0 w-8 h-1 rounded-b-full bg-accent/80 shadow-[0_0_10px_rgba(56,189,248,0.5)]" />
                                    )}
                                    <tab.icon className={`w-[22px] h-[22px] mb-1 transition-transform ${active ? 'scale-110' : ''}`} />
                                    <span className={`text-[10px] font-medium ${active ? 'text-accent' : ''}`}>
                                        {tab.label}
                                    </span>
                                </Link>
                            );
                        })}
                    </div>
                </div>
            </nav>

            <AdminMobileMenu
                isOpen={isMenuOpen}
                onClose={() => setIsMenuOpen(false)}
            />
        </>
    );
}
