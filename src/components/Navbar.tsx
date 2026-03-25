'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useSession, signOut } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import { Shield, Power, LogIn, ArrowLeft, Wrench } from 'lucide-react';

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

          {/* Right side actions */}
          <div className="flex items-center gap-1.5">
            {session ? (
              <>
                {/* Admin/Operator mode: Switch to User Mode (desktop only — mobile handled by layout) */}
                {(isInAdminMode || isInOperatorMode) && (
                  <Link
                    href="/slots"
                    className="hidden md:flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all text-white/70 hover:text-white hover:bg-white/10"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    User Mode
                  </Link>
                )}

                {/* User mode: Admin button for admin users */}
                {!isInAdminMode && !isInOperatorMode && isAdmin && (
                  <Link
                    href="/admin"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all text-white/70 hover:text-white hover:bg-white/10"
                  >
                    <Shield className="w-4 h-4" />
                    <span className="hidden md:inline">Admin</span>
                  </Link>
                )}

                {/* User mode: Operator button for operator users */}
                {!isInAdminMode && !isInOperatorMode && isOperator && (
                  <Link
                    href="/operator"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all text-white/70 hover:text-white hover:bg-white/10"
                  >
                    <Wrench className="w-4 h-4" />
                    <span className="hidden md:inline">Operator</span>
                  </Link>
                )}

                {/* Logout button - hidden on mobile in admin/operator mode since their layouts have their own */}
                <button
                  onClick={() => signOut({ callbackUrl: '/login' })}
                  className={`${isInAdminMode || isInOperatorMode ? 'hidden md:flex' : 'flex'} items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer text-white/70 hover:text-red-400 hover:bg-white/10`}
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
