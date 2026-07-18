'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useSession, signOut } from 'next-auth/react';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { Shield, Power, LogIn, ArrowLeft, Calendar, ClipboardList, Package, Wallet, Bell, Headset } from 'lucide-react';
import { CenterSelector } from './CenterSelector';
import { useCenter } from '@/lib/center-context';

export default function Navbar() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const { canAccessAdminPanelAtCurrentCenter, isStaffAtCurrentCenter, loading: centerLoading } = useCenter();
  const [scrolled, setScrolled] = useState(false);
  // For OTP-logged-in users who don't have a NextAuth session
  const [otpUserRole, setOtpUserRole] = useState<string | null>(null);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Fetch role from API for OTP users (no NextAuth session)
  useEffect(() => {
    if (status === 'loading') return;
    if (session) return; // NextAuth session exists, no need to fetch
    fetch('/api/user/profile')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.role) setOtpUserRole(data.role);
      })
      .catch(() => {});
  }, [session, status]);

  const isLoggedIn = !!session || !!otpUserRole;
  // Admin / staff buttons are gated by membership at the *currently selected* center,
  // not by the global User.role. A user who is ADMIN at Toplay but not at ABCA must
  // see the Admin button on Toplay and not on ABCA. Super admin bypass is folded
  // into these flags by the provider. While memberships are still loading we hide
  // the buttons to avoid a flash for users without admin rights.
  // Moderators (restricted admins) reach the admin panel through this same
  // button — the panel itself hides the surfaces they can't use.
  const showAdmin = isLoggedIn && !centerLoading && canAccessAdminPanelAtCurrentCenter;
  const showStaff = isLoggedIn && !centerLoading && isStaffAtCurrentCenter;
  const isInAdminMode = pathname.startsWith('/admin');
  // /operator is a legacy redirect to /staff; treat both as "staff mode"
  // so coach/sidearm users on /staff get the same chrome as operators did.
  const isInStaffMode = pathname.startsWith('/staff') || pathname.startsWith('/operator');

  if (pathname === '/') return null;

  const desktopNavLinks = [
    { href: '/slots', label: 'Book Slot', icon: Calendar },
    { href: '/bookings', label: 'My Bookings', icon: ClipboardList },
    { href: '/packages', label: 'Packages', icon: Package },
    { href: '/wallet', label: 'Wallet', icon: Wallet },
    { href: '/notifications', label: 'Alerts', icon: Bell },
  ];

  const isNavActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  const handleLogout = async () => {
    if (session) {
      // NextAuth (Google OAuth) logout
      signOut({ callbackUrl: '/login' });
    } else {
      // OTP logout — delete the token cookie and redirect
      document.cookie = 'token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
      setOtpUserRole(null);
      router.push('/login');
    }
  };

  return (
    <nav className={`sticky top-0 z-50 transition-all duration-300 ${scrolled ? 'bg-[#030712]/95 backdrop-blur-md shadow-lg shadow-black/20' : 'bg-transparent'
      }`}>
      <div className="max-w-5xl mx-auto px-4">
        <div className="flex justify-between h-14 md:h-16 items-center">
          {/* Logo */}
          <Link href={isLoggedIn ? '/slots' : '/'} className="flex items-center group">
            <Image
              src="/images/playorbit-logo.png"
              alt="PlayOrbit"
              width={320}
              height={96}
              priority
              className="h-20 md:h-28 w-auto object-contain flex-shrink-0 drop-shadow-[0_0_8px_rgba(100,140,255,0.3)]"
            />
          </Link>

          {/* Desktop Navigation Links — hidden on mobile (BottomNav handles mobile) */}
          {isLoggedIn && !isInAdminMode && !isInStaffMode && (
            <div className="hidden md:flex items-center gap-1">
              {desktopNavLinks.map(({ href, label, icon: Icon }) => {
                const active = isNavActive(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                      active
                        ? 'text-accent bg-accent/10'
                        : 'text-white/60 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {label}
                  </Link>
                );
              })}
            </div>
          )}

          {/* Right side actions */}
          <div className="flex items-center gap-1.5">
            {/* Center selector — visible to everyone (logged in or not) when 2+ centers exist.
                Auto-hides itself in the single-center case so this looks identical to before. */}
            {!isInAdminMode && !isInStaffMode && (
              <CenterSelector compact />
            )}

            {isLoggedIn ? (
              <>
                {/* Admin/Staff mode: Switch to User Mode */}
                {(isInAdminMode || isInStaffMode) && (
                  <Link
                    href="/slots"
                    className="hidden md:flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all text-white/70 hover:text-white hover:bg-white/10"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    User Mode
                  </Link>
                )}

                {/* User mode: Admin button — visible when the user is an ADMIN,
                    a MODERATOR, or a super admin at the currently-selected center. */}
                {!isInAdminMode && showAdmin && (
                  <Link
                    href="/admin"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all text-white/70 hover:text-white hover:bg-white/10"
                  >
                    <Shield className="w-4 h-4" />
                    <span className="hidden md:inline">Admin</span>
                  </Link>
                )}

                {/* Staff Dashboard button — only visible when the user holds a
                    staff role (OPERATOR / COACH / SIDEARM_SPECIALIST) or ADMIN
                    membership at the currently-selected center. */}
                {!isInStaffMode && showStaff && (
                  <Link
                    href="/staff"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all text-white/70 hover:text-white hover:bg-white/10"
                  >
                    <Headset className="w-4 h-4" />
                    <span className="hidden md:inline">Staff</span>
                  </Link>
                )}

                {/* Logout button - hidden on mobile in admin/staff mode since those layouts have their own */}
                <button
                  onClick={handleLogout}
                  className={`${(isInAdminMode || isInStaffMode) ? 'hidden md:flex' : 'flex'} items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer text-white/70 hover:text-red-400 hover:bg-white/10`}
                >
                  <Power className="w-4 h-4" />
                  <span className="hidden md:inline">Logout</span>
                </button>
              </>
            ) : pathname !== '/' && (
              <Link
                href="/login"
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all bg-accent text-primary hover:bg-accent-light"
              >
                <LogIn className="w-4 h-4" />
                Login
              </Link>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
