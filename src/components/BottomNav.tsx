'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCurrentUser } from '@/lib/current-user';
import { Calendar, ClipboardList, Package, Wallet, Bell, Zap, UserCog, ShoppingBag } from 'lucide-react';
import { useCenter } from '@/lib/center-context';
import { useMarketplaceStatus } from '@/lib/marketplace-status';
import { SHOP_PATH } from '@/lib/marketplace';

const baseTabs = [
  { href: '/slots', label: 'Book Slot', icon: Calendar },
  { href: '/bookings', label: 'Bookings', icon: ClipboardList },
  { href: '/packages', label: 'Packages', icon: Package },
];

// The store sits after Packages. It is per center, so a center that has it
// switched off shows no tab at all.
const shopTab = { href: SHOP_PATH, label: 'Shop', icon: ShoppingBag };

const accountTabs = [
  { href: '/wallet', label: 'Wallet', icon: Wallet },
  { href: '/notifications', label: 'Alerts', icon: Bell },
];

// Sidearm specialists get an extra tab to manage their own availability.
const sidearmTab = { href: '/sidearm', label: 'Sidearm', icon: Zap };
// Coaches get the same — a tab to manage their own coaching availability.
const coachTab = { href: '/coach', label: 'Coach', icon: UserCog };

export default function BottomNav() {
  // One shared profile read instead of this component's own
  // /api/user/profile fetch — see @/lib/current-user.
  const { user } = useCurrentUser();
  const { isSidearmSpecialistAtCurrentCenter, isCoachAtCurrentCenter } = useCenter();
  const { enabled: shopEnabled } = useMarketplaceStatus();
  const pathname = usePathname();

  const isLoggedIn = !!user;

  // Only show for logged-in users, hide on landing/login/admin pages
  if (!isLoggedIn) return null;
  if (pathname === '/' || pathname === '/login' || pathname === '/otp') return null;
  if (pathname.startsWith('/admin')) return null;

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  // Append role-specific availability tabs only for staff who hold that
  // role at the current center. A user who is both gets both tabs.
  const tabs = [
    ...baseTabs,
    ...(shopEnabled ? [shopTab] : []),
    ...accountTabs,
    ...(isSidearmSpecialistAtCurrentCenter ? [sidearmTab] : []),
    ...(isCoachAtCurrentCenter ? [coachTab] : []),
  ];

  // Six tabs fit a 360px phone at 10px; a staff member with both extra
  // tabs (7–8) needs the smaller label so nothing overflows its tab.
  const labelSize = tabs.length >= 7 ? 'text-[9px]' : 'text-[10px]';

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
                className={`flex flex-col items-center justify-center flex-1 min-w-0 px-0.5 h-full relative overflow-hidden transition-colors ${
                  active ? 'text-accent' : 'text-slate-400'
                }`}
              >
                {active && (
                  <span className="absolute top-1 w-1 h-1 rounded-full bg-accent" />
                )}
                <Icon className={`w-5 h-5 ${active ? 'text-accent' : 'text-slate-400'}`} />
                <span className={`${labelSize} mt-0.5 font-medium whitespace-nowrap ${active ? 'text-accent' : 'text-slate-400'}`}>
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
