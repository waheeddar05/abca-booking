'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useSession, signOut } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import { Shield, Power, LogIn, ArrowLeft, Calendar, ClipboardList, Package, Wallet, Bell } from 'lucide-react';

export default function Navbar() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const isAdmin = session?.user?.role === 'ADMIN';
  const isOperator = session?.user?.role === 'OPERATOR';
  const isInAdminMode = pathname.startsWith('/admin');
  const isInOperatorMode = pathname.startsWith('/operator');

  if (pathname === '/') return null;

  const desktopNavLinks = [
    { href: '/slots', label: 'Book Slot', icon: Calendar },
    { href: '/bookings', label: 'My Bookings', icon: ClipboardList },
    { href: '/packages', label: 'Packages', icon: Package },
    { href: '/wallet', label: 'Wallet', icon: Wallet },
    { href: '/notifications', label: 'Alerts', icon: Bell },
  ];

  const isNavActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  return (
    <nav className={`sticky top-0 z-50 transition-all duration-300 ${scrolled ? 'bg-[#030712]/95 backdrop-blur-md shadow-lg shadow-black/20' : 'bg-transparent'
      }`}>
      <div className="max-w-5xl mx-auto px-4">
        <div className="flex justify-between h-14 md:h-16 items-center">
          {/* Logo */}
          <Link href={session ? '/slots' : '/'} className="flex items-center group">
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
          {session && !isInAdminMode && !isInOperatorMode && (
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
            {session ? (
              <>
                {/* Admin mode: Switch to User Mode */}
                {isInAdminMode && (
                  <Link
                    href="/slots"
                    className="hidden md:flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all text-white/70 hover:text-white hover:bg-white/10"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    User Mode
                  </Link>
                )}

                {/* User mode: Admin button for admin users */}
                {!isInAdminMode && isAdmin && (
                  <Link
                    href="/admin"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all text-white/70 hover:text-white hover:bg-white/10"
                  >
                    <Shield className="w-4 h-4" />
                    <span className="hidden md:inline">Admin</span>
                  </Link>
                )}

                {/* Logout button - hidden on mobile in admin mode since admin layout has its own */}
                <button
                  onClick={() => signOut({ callbackUrl: '/login' })}
                  className={`${isInAdminMode ? 'hidden md:flex' : 'flex'} items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer text-white/70 hover:text-red-400 hover:bg-white/10`}
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
