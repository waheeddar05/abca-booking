'use client';

import Link from 'next/link';
import { useSession, signOut } from 'next-auth/react';
import { usePathname } from 'next/navigation';

export default function Navbar() {
  const { data: session } = useSession();
  const pathname = usePathname();

  return (
    <nav className="bg-white border-b border-gray-200">
      <div className="max-w-4xl mx-auto px-4 flex justify-between h-16 items-center">
        <Link href="/slots" className="text-xl font-bold text-red-600">
          ABCA Cricket
        </Link>
        <div className="flex space-x-6 items-center">
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
      </div>
    </nav>
  );
}
