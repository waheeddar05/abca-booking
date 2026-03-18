'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Calendar, ClipboardList, Package, Wallet, Bell } from 'lucide-react';

const tabs = [
  { href: '/slots', label: 'Book Slot', icon: Calendar },
  { href: '/bookings', label: 'Bookings', icon: ClipboardList },
  { href: '/packages', label: 'Packages', icon: Package },
  { href: '/wallet', label: 'Wallet', icon: Wallet },
  { href: '/notifications', label: 'Alerts', icon: Bell },
];

export default function BottomNav() {
  const { data: session } = useSession();
  const pathname = usePathname();

  // Only show for logged-in users, hide on landing/login/admin/operator pages
  if (!session) return null;
  if (pathname === '/' || pathname === '/login' || pathname === '/otp') return null;
  if (pathname.startsWith('/admin') || pathname.startsWith('/operator')) return null;

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden">
      <div className="bg-[#0a1628]/90 backdrop-blur-xl border-t border-white/[0.08]">
        <div className="flex items-center justify-around h-[60px]">
          {tabs.map(({ href, label, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex flex-col items-center justify-center flex-1 h-full relative transition-colors ${
                  active ? 'text-accent' : 'text-slate-400'
                }`}
              >
                {active && (
                  <span className="absolute top-1 w-1 h-1 rounded-full bg-accent" />
                )}
                <Icon className={`w-5 h-5 ${active ? 'text-accent' : 'text-slate-400'}`} />
                <span className={`text-[10px] mt-0.5 font-medium ${active ? 'text-accent' : 'text-slate-400'}`}>
                  {label}
                </span>
              </Link>
            );
          })}
        </div>
        {/* Safe area padding for iOS */}
        <div className="safe-bottom" />
      </div>
    </nav>
  );
}
