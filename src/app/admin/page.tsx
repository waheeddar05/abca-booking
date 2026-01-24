'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';

interface Stats {
  totalBookings: number;
  activeAdmins: number;
  systemStatus: string;
}

export default function AdminDashboard() {
  const { data: session } = useSession();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  const isSuperAdmin = session?.user?.email === 'waheeddar8@gmail.com';

  useEffect(() => {
    async function fetchStats() {
      try {
        const response = await fetch('/api/admin/stats');
        if (response.ok) {
          const data = await response.json();
          setStats(data);
        }
      } catch (error) {
        console.error('Failed to fetch stats:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchStats();
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 mb-6">Admin Dashboard</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
          <h3 className="text-sm font-medium text-gray-500 uppercase">Total Bookings</h3>
          <p className="text-3xl font-bold text-gray-800 mt-2">
            {loading ? 'Loading...' : stats?.totalBookings ?? 0}
          </p>
        </div>
        
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
          <h3 className="text-sm font-medium text-gray-500 uppercase">Active Admins</h3>
          <p className="text-3xl font-bold text-gray-800 mt-2">
            {loading ? 'Loading...' : stats?.activeAdmins ?? 0}
          </p>
        </div>
        
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
          <h3 className="text-sm font-medium text-gray-500 uppercase">System Status</h3>
          <p className="text-3xl font-bold text-green-600 mt-2">
            {loading ? 'Checking...' : stats?.systemStatus ?? 'Healthy'}
          </p>
        </div>
      </div>

      <div className="mt-8 bg-white p-6 rounded-lg shadow-sm border border-gray-100">
        <h2 className="text-lg font-bold text-gray-800 mb-4">Quick Actions</h2>
        <div className="flex flex-wrap gap-4">
          {isSuperAdmin && (
            <Link href="/admin/users" className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md transition-colors">
              Invite New Admin
            </Link>
          )}
          <Link href="/admin/bookings" className="bg-gray-100 hover:bg-gray-200 text-gray-800 px-4 py-2 rounded-md transition-colors">
            View Today's Bookings
          </Link>
          <Link href="/admin/policies" className="bg-gray-100 hover:bg-gray-200 text-gray-800 px-4 py-2 rounded-md transition-colors">
            Update Policies
          </Link>
        </div>
      </div>
    </div>
  );
}
