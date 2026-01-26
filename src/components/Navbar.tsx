'use client';

import Link from 'next/link';
import { useSession, signOut } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Menu, X } from 'lucide-react';

export default function Navbar() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const toggleMenu = () => setIsMenuOpen(!isMenuOpen);

  return (
    <nav className="bg-white border-b border-gray-200">
      <div className="max-w-4xl mx-auto px-4">
        <div className="flex justify-between h-16 items-center">
          <Link href="/slots" className="text-xl font-bold text-red-600">
            ABCA Cricket
          </Link>

          {/* Desktop Menu */}
          <div className="hidden md:flex space-x-6 items-center">
            {session && (
              <>
                <Link href="/slots" className="text-gray-600 hover:text-red-600 font-medium">
                  Slots
                </Link>
                <Link href="/bookings" className="text-gray-600 hover:text-red-600 font-medium">
                  My Bookings
                </Link>
              </>
            )}
            {(session?.user as any)?.role === 'ADMIN' && (
              <Link href="/admin" className="text-gray-600 hover:text-red-600 font-medium">
                Admin
              </Link>
            )}
            {session ? (
              <div className="flex items-center space-x-4">
                <span className="text-sm text-gray-700">{session.user?.name || session.user?.email}</span>
                <button
                  onClick={() => signOut({ callbackUrl: '/login' })}
                  className="text-gray-600 hover:text-red-600 font-medium cursor-pointer"
                >
                  Logout
                </button>
              </div>
            ) : pathname !== '/' && (
              <Link href="/login" className="text-gray-600 hover:text-red-600 font-medium">
                Login
              </Link>
            )}
          </div>

          {/* Mobile menu button */}
          <div className="md:hidden flex items-center">
            <button
              onClick={toggleMenu}
              className="inline-flex items-center justify-center p-2 rounded-md text-gray-600 hover:text-red-600 hover:bg-gray-100 focus:outline-none"
            >
              <span className="sr-only">Open main menu</span>
              {isMenuOpen ? <X className="block h-6 w-6" /> : <Menu className="block h-6 w-6" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      {isMenuOpen && (
        <div className="md:hidden bg-white border-t border-gray-100">
          <div className="px-2 pt-2 pb-3 space-y-1">
            {session ? (
              <>
                <div className="px-3 py-2 text-sm font-semibold text-gray-900 border-b border-gray-100 mb-2">
                  {session.user?.name || session.user?.email}
                </div>
                <Link
                  href="/slots"
                  className="block px-3 py-2 rounded-md text-base font-medium text-gray-600 hover:text-red-600 hover:bg-gray-50"
                  onClick={() => setIsMenuOpen(false)}
                >
                  Slots
                </Link>
                <Link
                  href="/bookings"
                  className="block px-3 py-2 rounded-md text-base font-medium text-gray-600 hover:text-red-600 hover:bg-gray-50"
                  onClick={() => setIsMenuOpen(false)}
                >
                  My Bookings
                </Link>
                {(session?.user as any)?.role === 'ADMIN' && (
                  <Link
                    href="/admin"
                    className="block px-3 py-2 rounded-md text-base font-medium text-gray-600 hover:text-red-600 hover:bg-gray-50"
                    onClick={() => setIsMenuOpen(false)}
                  >
                    Admin
                  </Link>
                )}
                <button
                  onClick={() => {
                    setIsMenuOpen(false);
                    signOut({ callbackUrl: '/login' });
                  }}
                  className="block w-full text-left px-3 py-2 rounded-md text-base font-medium text-gray-600 hover:text-red-600 hover:bg-gray-50"
                >
                  Logout
                </button>
              </>
            ) : pathname !== '/' && (
              <Link
                href="/login"
                className="block px-3 py-2 rounded-md text-base font-medium text-gray-600 hover:text-red-600 hover:bg-gray-50"
                onClick={() => setIsMenuOpen(false)}
              >
                Login
              </Link>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
