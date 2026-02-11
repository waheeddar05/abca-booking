'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useSession, signOut } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import { Menu, X, Calendar, ClipboardList, Shield, LogOut, LogIn } from 'lucide-react';

export default function Navbar() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  const isLanding = pathname === '/' || pathname === '/login' || pathname === '/otp';

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
    { href: '/slots', label: 'Book Slots', icon: Calendar, show: !!session },
    { href: '/bookings', label: 'My Bookings', icon: ClipboardList, show: !!session },
    { href: '/admin', label: 'Admin', icon: Shield, show: (session?.user as any)?.role === 'ADMIN' },
  ].filter(link => link.show);

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  const userImage = session?.user?.image;
  const userName = session?.user?.name;
  const userInitial = userName ? userName.charAt(0).toUpperCase() : (session?.user?.email?.charAt(0).toUpperCase() || '?');

  return (
    <nav className={`sticky top-0 z-50 transition-all duration-300 ${
      isLanding
        ? scrolled ? 'bg-[#0f1d2f]/95 backdrop-blur-md shadow-lg' : 'bg-transparent'
        : scrolled ? 'bg-white/95 backdrop-blur-md shadow-sm border-b border-gray-100' : 'bg-white border-b border-gray-100'
    }`}>
      <div className="max-w-5xl mx-auto px-4">
        <div className="flex justify-between h-14 md:h-16 items-center">
          {/* Logo */}
          <Link href={session ? '/slots' : '/'} className="flex items-center gap-2 group">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm transition-colors ${
              isLanding ? 'bg-accent text-primary' : 'bg-primary text-accent'
            }`}>
              AC
            </div>
            <span className={`text-lg font-bold tracking-tight transition-colors ${
              isLanding ? 'text-white' : 'text-primary'
            }`}>
              ABCA Cricket
            </span>
          </Link>

          {/* Desktop Menu */}
          <div className="hidden md:flex items-center gap-1">
            {navLinks.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  isActive(href)
                    ? isLanding
                      ? 'bg-white/15 text-accent'
                      : 'bg-primary/5 text-primary'
                    : isLanding
                      ? 'text-white/70 hover:text-white hover:bg-white/10'
                      : 'text-gray-500 hover:text-primary hover:bg-gray-50'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </Link>
            ))}

            {session ? (
              <div className="flex items-center ml-2 pl-2 border-l border-gray-200/20">
                <div className="flex items-center gap-2 mr-3">
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
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                      isLanding ? 'bg-accent text-primary' : 'bg-primary/10 text-primary'
                    }`}>
                      {userInitial}
                    </div>
                  )}
                  <span className={`text-xs font-medium max-w-[120px] truncate ${
                    isLanding ? 'text-white/60' : 'text-gray-400'
                  }`}>
                    {session.user?.name || session.user?.email}
                  </span>
                </div>
                <button
                  onClick={() => signOut({ callbackUrl: '/login' })}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer ${
                    isLanding
                      ? 'text-white/70 hover:text-white hover:bg-white/10'
                      : 'text-gray-500 hover:text-danger hover:bg-red-50'
                  }`}
                >
                  <LogOut className="w-4 h-4" />
                  Logout
                </button>
              </div>
            ) : pathname !== '/' && (
              <Link
                href="/login"
                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                  isLanding
                    ? 'bg-accent text-primary hover:bg-accent-light'
                    : 'bg-primary text-white hover:bg-primary-light'
                }`}
              >
                <LogIn className="w-4 h-4" />
                Login
              </Link>
            )}
          </div>

          {/* Mobile menu button */}
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className={`md:hidden p-2 rounded-lg transition-colors cursor-pointer ${
              isLanding
                ? 'text-white/80 hover:bg-white/10'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {isMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Menu - Slide down */}
      <div className={`md:hidden overflow-hidden transition-all duration-300 ease-in-out ${
        isMenuOpen ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
      }`}>
        <div className={`px-4 pb-4 pt-1 space-y-1 ${
          isLanding ? 'bg-[#0f1d2f]/98 backdrop-blur-md' : 'bg-white border-t border-gray-100'
        }`}>
          {session && (
            <div className={`flex items-center gap-3 px-3 py-2.5 mb-2 rounded-lg text-sm font-medium ${
              isLanding ? 'bg-white/5 text-white/80' : 'bg-gray-50 text-gray-700'
            }`}>
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
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                  isLanding ? 'bg-accent text-primary' : 'bg-primary/10 text-primary'
                }`}>
                  {userInitial}
                </div>
              )}
              <span className="truncate">{session.user?.name || session.user?.email}</span>
            </div>
          )}

          {navLinks.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-colors ${
                isActive(href)
                  ? isLanding
                    ? 'bg-accent/15 text-accent'
                    : 'bg-primary/5 text-primary'
                  : isLanding
                    ? 'text-white/70 hover:bg-white/5'
                    : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Icon className="w-5 h-5" />
              {label}
            </Link>
          ))}

          {session ? (
            <button
              onClick={() => signOut({ callbackUrl: '/login' })}
              className={`flex items-center gap-3 w-full px-3 py-3 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                isLanding
                  ? 'text-red-400 hover:bg-white/5'
                  : 'text-danger hover:bg-red-50'
              }`}
            >
              <LogOut className="w-5 h-5" />
              Logout
            </button>
          ) : pathname !== '/' && (
            <Link
              href="/login"
              className={`flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-semibold transition-all ${
                isLanding
                  ? 'bg-accent text-primary'
                  : 'bg-primary text-white'
              }`}
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
