'use client';

import Link from 'next/link';
import { useSession } from 'next-auth/react';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data: session } = useSession();
  const isSuperAdmin = session?.user?.email === 'waheeddar8@gmail.com';

  return (
    <div className="flex min-h-[calc(100vh-64px)]">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 p-6 space-y-2">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">
          Admin Menu
        </h2>
        <nav className="space-y-1">
          <Link
            href="/admin"
            className="block px-3 py-2 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-100 hover:text-blue-600"
          >
            Dashboard
          </Link>
          <Link
            href="/admin/bookings"
            className="block px-3 py-2 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-100 hover:text-blue-600"
          >
            All Bookings
          </Link>
          {isSuperAdmin && (
            <Link
              href="/admin/users"
              className="block px-3 py-2 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-100 hover:text-blue-600"
            >
              Manage Admins
            </Link>
          )}
          <Link
            href="/admin/policies"
            className="block px-3 py-2 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-100 hover:text-blue-600"
          >
            Policy Management
          </Link>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 bg-gray-50 p-8">
        <div className="max-w-6xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
