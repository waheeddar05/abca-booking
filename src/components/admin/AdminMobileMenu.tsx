'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { X, Users, Package, Settings, SlidersHorizontal, Wrench, CalendarPlus, ChevronRight, ArrowLeft } from 'lucide-react';
import { useEffect } from 'react';

const SUPER_ADMIN_EMAIL = 'waheeddar8@gmail.com';

export function AdminMobileMenu({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
    const pathname = usePathname();
    const { data: session } = useSession();
    const isSuperAdmin = session?.user?.email === SUPER_ADMIN_EMAIL;

    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => {
            document.body.style.overflow = '';
        };
    }, [isOpen]);

    const links = [
        { href: '/admin/users', label: 'Users', icon: Users },
        { href: '/admin/packages', label: 'Packages', icon: Package },
        { href: '/admin/configuration', label: 'Configuration', icon: SlidersHorizontal },
        { href: '/admin/policies', label: 'Policies', icon: Settings },
        ...(isSuperAdmin ? [{ href: '/admin/maintenance', label: 'Maintenance', icon: Wrench }] : []),
    ];

    const isActive = (href: string) => pathname.startsWith(href);

    return (
        <div className={`fixed inset-0 z-[60] md:hidden transition-all duration-300 ease-out ${isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
            }`}>
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Menu overlay sliding up from bottom */}
            <div className={`absolute bottom-0 left-0 right-0 max-h-[90vh] bg-[#0b1726]/95 backdrop-blur-xl border-t border-white/[0.08] rounded-t-3xl p-5 overflow-y-auto pb-safe transition-transform duration-300 transform ${isOpen ? 'translate-y-0 shadow-[0_-10px_40px_rgba(0,0,0,0.5)]' : 'translate-y-full'
                }`}>
                <div className="flex items-center justify-between mb-6 pb-4 border-b border-white/[0.08]">
                    <h2 className="text-xl font-bold text-white tracking-tight">More Options</h2>
                    <button
                        onClick={onClose}
                        className="w-8 h-8 rounded-full bg-white/[0.05] flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.1] transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Back to App - prominent escape hatch */}
                <Link
                    href="/slots"
                    onClick={onClose}
                    className="flex items-center gap-4 bg-gradient-to-r from-emerald-500/15 to-emerald-500/5 border border-emerald-500/20 rounded-2xl p-4 mb-4"
                >
                    <div className="w-12 h-12 rounded-xl bg-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-500/20 shrink-0">
                        <ArrowLeft className="w-6 h-6 text-white" />
                    </div>
                    <div className="flex-1">
                        <h3 className="text-[15px] font-semibold text-white">Back to App</h3>
                        <p className="text-xs text-slate-400 mt-1">Return to Book Slot, My Bookings, Packages</p>
                    </div>
                </Link>

                {/* Quick action: "Book a Slot" */}
                <Link
                    href="/slots"
                    onClick={onClose}
                    className="flex items-center gap-4 bg-gradient-to-r from-accent/15 to-accent/5 border border-accent/20 rounded-2xl p-4 mb-6"
                >
                    <div className="w-12 h-12 rounded-xl bg-accent flex items-center justify-center shadow-lg shadow-accent/20 shrink-0">
                        <CalendarPlus className="w-6 h-6 text-primary" />
                    </div>
                    <div className="flex-1">
                        <h3 className="text-[15px] font-semibold text-white">Book a Slot</h3>
                        <p className="text-xs text-slate-400 mt-1">Make a booking on behalf of a user</p>
                    </div>
                </Link>

                {/* Other sections */}
                <div className="space-y-2">
                    {links.map(({ href, label, icon: Icon }) => {
                        const active = isActive(href);
                        return (
                            <Link
                                key={href}
                                href={href}
                                onClick={onClose}
                                className={`flex items-center gap-4 px-4 py-3.5 rounded-2xl transition-all duration-200 group ${active
                                        ? 'bg-white/[0.08] border border-white/[0.05]'
                                        : 'bg-white/[0.02] border border-transparent hover:bg-white/[0.05]'
                                    }`}
                            >
                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-transform ${active ? 'bg-accent/15 text-accent' : 'bg-white/[0.05] text-slate-400 group-hover:scale-110'
                                    }`}>
                                    <Icon className="w-5 h-5" />
                                </div>
                                <div className="flex-1">
                                    <h4 className={`text-base font-semibold ${active ? 'text-white' : 'text-slate-200'}`}>
                                        {label}
                                    </h4>
                                </div>
                                <ChevronRight className={`w-5 h-5 ${active ? 'text-accent' : 'text-slate-500'}`} />
                            </Link>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
