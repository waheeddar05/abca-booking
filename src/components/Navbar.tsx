'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useSession, signOut } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import { Menu, X, Calendar, ClipboardList, Shield, LogOut, LogIn, Package, Bell, Wrench, Wallet } from 'lucide-react';

export default function Navbar() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Close menu on route change
  useEffect(() => {
    setIsMenuOpen(false);
  }, [pathname]);

  const navLinks = [
    { href: '/slots', label: 'Book Slots', icon: Calendar, show: !!session, hideOnMobile: true },
    { href: '/bookings', label: 'My Bookings', icon: ClipboardList, show: !!session, hideOnMobile: true },
    { href: '/packages', label: 'Packages', icon: Package, show: !!session, hideOnMobile: true },
    { href: '/operator', label: 'Operator', icon: Wrench, show: session?.user?.role === 'OPERATOR' },
    { href: '/admin', label: 'Admin', icon: Shield, show: session?.user?.role === 'ADMIN' },
  ].filter(link => link.show);

  const profileLinks = [
    { href: '/wallet', label: 'Wallet', icon: Wallet },
    { href: '/notifications', label: 'Notifications', icon: Bell },
  ];

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  const userImage = session?.user?.image;
  const userName = session?.user?.name;
  const userInitial = userName ? userName.charAt(0).toUpperCase() : (session?.user?.email?.charAt(0).toUpperCase() || '?');

  if (pathname === '/') return null;

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

          {/* Desktop Menu */}
          <div className="hidden md:flex items-center gap-1">
            {navLinks.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${isActive(href)
                  ? 'bg-white/15 text-accent'
                  : 'text-white/70 hover:text-white hover:bg-white/10'
                  }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </Link>
            ))}

            {session ? (
              <div className="flex items-center ml-2 pl-2 border-l border-white/10 gap-1">
                {profileLinks.map(({ href, label, icon: Icon }) => (
                  <Link
                    key={href}
                    href={href}
                    className={`flex items-center gap-1.5 px-2 py-2 rounded-lg text-sm font-medium transition-all ${isActive(href)
                      ? 'bg-white/15 text-accent'
                      : 'text-white/70 hover:text-white hover:bg-white/10'
                    }`}
                    title={label}
                  >
                    <Icon className="w-4 h-4" />
                  </Link>
                ))}
                <div className="flex items-center gap-2 ml-1 mr-2">
                  {userImage ? (
                    <Image
                      src={userImage}
                      alt={userName || 'Profile'}
                      width={28}
                      height={28}
                      className="rounded-full"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold bg-accent text-primary">
                      {userInitial}
                    </div>
                  )}
                  <span className="text-xs font-medium max-w-[120px] truncate text-white/70">
                    {session.user?.name || session.user?.email}
                  </span>
                </div>
                <button
                  onClick={() => signOut({ callbackUrl: '/login' })}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer text-white/70 hover:text-red-400 hover:bg-white/10"
                >
                  <LogOut className="w-4 h-4" />
                  Logout
                </button>
              </div>
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

          {/* Mobile menu button */}
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="md:hidden p-2 rounded-lg transition-colors cursor-pointer text-white/80 hover:bg-white/10"
            aria-expanded={isMenuOpen}
            aria-controls="mobile-nav-menu"
            aria-label={isMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
          >
            {isMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Menu - Slide down */}
      <div
        id="mobile-nav-menu"
        className={`md:hidden overflow-hidden transition-all duration-300 ease-in-out ${isMenuOpen ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="px-4 pb-4 pt-1 space-y-1 bg-[#030712]/98 backdrop-blur-md">
          {session && (
            <div className="flex items-center gap-3 px-3 py-2.5 mb-2 rounded-lg text-sm font-medium bg-white/5 text-white/80">
              {userImage ? (
                <Image
                  src={userImage}
                  alt={userName || 'Profile'}
                  width={32}
                  height={32}
                  className="rounded-full"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold bg-accent text-primary">
                  {userInitial}
                </div>
              )}
              <span className="truncate">{session.user?.name || session.user?.email}</span>
            </div>
          )}

          {navLinks.filter(l => !(l as any).hideOnMobile).map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-colors ${isActive(href)
                ? 'bg-accent/15 text-accent'
                : 'text-white/70 hover:bg-white/5'
                }`}
            >
              <Icon className="w-5 h-5" />
              {label}
            </Link>
          ))}

          {session && profileLinks.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-colors ${isActive(href)
                ? 'bg-accent/15 text-accent'
                : 'text-white/70 hover:bg-white/5'
                }`}
            >
              <Icon className="w-5 h-5" />
              {label}
            </Link>
          ))}

          {session ? (
            <button
              onClick={() => signOut({ callbackUrl: '/login' })}
              className="flex items-center gap-3 w-full px-3 py-3 rounded-lg text-sm font-medium transition-colors cursor-pointer text-red-400 hover:bg-white/5"
            >
              <LogOut className="w-5 h-5" />
              Logout
            </button>
          ) : pathname !== '/' && (
            <Link
              href="/login"
              className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-semibold transition-all bg-accent text-primary"
            >
              <LogIn className="w-5 h-5" />
              Login
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
