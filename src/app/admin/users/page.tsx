'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';

export default function AdminManagement() {
  const { data: session } = useSession();
  const [admins, setAdmins] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState({ text: '', type: '' });

  const isSuperAdmin = session?.user?.email === 'waheeddar8@gmail.com';

  const fetchAdmins = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/users');
      if (res.ok) {
        const data = await res.json();
        setAdmins(data);
      }
    } catch (error) {
      console.error('Failed to fetch admins', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAdmins();
  }, []);

  const handleAddAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage({ text: '', type: '' });
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ text: 'Admin added successfully', type: 'success' });
        setEmail('');
        fetchAdmins();
      } else {
        setMessage({ text: data.error || 'Failed to add admin', type: 'error' });
      }
    } catch (error) {
      setMessage({ text: 'Internal server error', type: 'error' });
    }
  };

  const handleRemoveAdmin = async (id: string) => {
    if (!confirm('Are you sure you want to remove this admin?')) return;
    setMessage({ text: '', type: '' });
    try {
      const res = await fetch('/api/admin/users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ text: 'Admin removed successfully', type: 'success' });
        fetchAdmins();
      } else {
        setMessage({ text: data.error || 'Failed to remove admin', type: 'error' });
      }
    } catch (error) {
      setMessage({ text: 'Internal server error', type: 'error' });
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 mb-6">Manage Admins</h1>

      {isSuperAdmin && (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 mb-8">
          <h2 className="text-lg font-bold text-gray-800 mb-4">Add / Invite New Admin</h2>
          <form onSubmit={handleAddAdmin} className="flex gap-4">
            <input
              type="email"
              placeholder="Enter email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="flex-1 border rounded px-3 py-2"
            />
            <button
              type="submit"
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded transition-colors"
            >
              Add Admin
            </button>
          </form>
          {message.text && (
            <p className={`mt-2 text-sm ${message.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
              {message.text}
            </p>
          )}
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase">Name</th>
              <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase">Email</th>
              <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase">Added On</th>
              <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading ? (
              <tr>
                <td colSpan={4} className="px-6 py-4 text-center text-gray-500">Loading admins...</td>
              </tr>
            ) : (
              admins.map((admin) => (
                <tr key={admin.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm text-gray-900">{admin.name || 'N/A'}</td>
                  <td className="px-6 py-4 text-sm text-gray-900">{admin.email}</td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {new Date(admin.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 text-right text-sm font-medium">
                    {isSuperAdmin && admin.email !== 'waheeddar8@gmail.com' && (
                      <button
                        onClick={() => handleRemoveAdmin(admin.id)}
                        className="text-red-600 hover:text-red-900"
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
