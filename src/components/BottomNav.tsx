'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useState, useEffect } from 'react';
import { Calendar, ClipboardList, Package, Wallet, Bell, Zap } from 'lucide-react';
import { useCenter } from '@/lib/center-context';

const baseTabs = [
  { href: '/slots', label: 'Book Slot', icon: Calendar },
  { href: '/bookings', label: 'Bookings', icon: ClipboardList },
  { href: '/packages', label: 'Packages', icon: Package },
  { href: '/wallet', label: 'Wallet', icon: Wallet },
  { href: '/notifications', label: 'Alerts', icon: Bell },
];

// Sidearm specialists get an extra tab to manage their own availability.
const sidearmTab = { href: '/sidearm', label: 'Sidearm', icon: Zap };

export default function BottomNav() {
  const { data: session, status } = useSession();
  const { isSidearmSpecialistAtCurrentCenter } = useCenter();
  const pathname = usePathname();
  const [otpUserRole, setOtpUserRole] = useState<string | null>(null);

  // Fetch role from API for OTP users (no NextAuth session)
  useEffect(() => {
    if (status === 'loading') return;
    if (session) return;
    fetch('/api/user/profile')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.role) setOtpUserRole(data.role);
      })
      .catch(() => {});
  }, [session, status]);

  const isLoggedIn = !!session || !!otpUserRole;

  // Only show for logged-in users, hide on landing/login/admin pages
  if (!isLoggedIn) return null;
  if (pathname === '/' || pathname === '/login' || pathname === '/otp') return null;
  if (pathname.startsWith('/admin')) return null;

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  // Append the Sidearm tab only for specialists at the current center.
  const tabs = isSidearmSpecialistAtCurrentCenter ? [...baseTabs, sidearmTab] : baseTabs;

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
                <span className={`text-[10px] mt-0.5 font-medium whitespace-nowrap ${active ? 'text-accent' : 'text-slate-400'}`}>
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
