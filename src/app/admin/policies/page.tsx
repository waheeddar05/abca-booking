'use client';

import { useState, useEffect } from 'react';

export default function PolicyManagement() {
  const [policies, setPolicies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newPolicy, setNewPolicy] = useState({ key: '', value: '' });
  const [message, setMessage] = useState({ text: '', type: '' });

  const fetchPolicies = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/policies');
      if (res.ok) {
        const data = await res.json();
        setPolicies(data);
      }
    } catch (error) {
      console.error('Failed to fetch policies', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPolicies();
  }, []);

  const handleUpdatePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage({ text: '', type: '' });
    try {
      const res = await fetch('/api/admin/policies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newPolicy),
      });
      if (res.ok) {
        setMessage({ text: 'Policy updated successfully', type: 'success' });
        setNewPolicy({ key: '', value: '' });
        fetchPolicies();
      } else {
        const data = await res.json();
        setMessage({ text: data.error || 'Failed to update policy', type: 'error' });
      }
    } catch (error) {
      setMessage({ text: 'Internal server error', type: 'error' });
    }
  };

  const handleDeletePolicy = async (key: string) => {
    if (!confirm(`Are you sure you want to delete the policy "${key}"?`)) {
      return;
    }
    setMessage({ text: '', type: '' });
    try {
      const res = await fetch(`/api/admin/policies?key=${encodeURIComponent(key)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setMessage({ text: 'Policy deleted successfully', type: 'success' });
        fetchPolicies();
      } else {
        const data = await res.json();
        setMessage({ text: data.error || 'Failed to delete policy', type: 'error' });
      }
    } catch (error) {
      setMessage({ text: 'Internal server error', type: 'error' });
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 mb-6">Policy Management</h1>

      <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 mb-8">
        <h2 className="text-lg font-bold text-gray-800 mb-4">Quick Links & Help</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
          <div>
            <h3 className="font-semibold mb-2">Timing Configuration Keys:</h3>
            <ul className="list-disc list-inside space-y-1 text-gray-600">
              <li><code className="bg-gray-100 px-1 rounded">SLOT_WINDOW_START</code>: Start hour (e.g. 7)</li>
              <li><code className="bg-gray-100 px-1 rounded">SLOT_WINDOW_END</code>: End hour (e.g. 22)</li>
              <li><code className="bg-gray-100 px-1 rounded">SLOT_DURATION</code>: Minutes per slot (e.g. 30)</li>
            </ul>
          </div>
          <div>
            <h3 className="font-semibold mb-2">Other Keys:</h3>
            <ul className="list-disc list-inside space-y-1 text-gray-600">
              <li><code className="bg-gray-100 px-1 rounded">DISABLED_DATES</code>: Comma-separated (e.g. 2026-01-26,2026-01-27)</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 mb-8">
        <h2 className="text-lg font-bold text-gray-800 mb-4">Update or Create Policy</h2>
        <form onSubmit={handleUpdatePolicy} className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Policy Key</label>
            <input
              type="text"
              placeholder="e.g. cancellation_rules"
              value={newPolicy.key}
              onChange={(e) => setNewPolicy({ ...newPolicy, key: e.target.value })}
              required
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Policy Value</label>
            <div className="flex gap-4">
              <input
                type="text"
                placeholder="Enter policy description or value"
                value={newPolicy.value}
                onChange={(e) => setNewPolicy({ ...newPolicy, value: e.target.value })}
                required
                className="flex-1 border rounded px-3 py-2"
              />
              <button
                type="submit"
                className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded transition-colors whitespace-nowrap"
              >
                Save Policy
              </button>
            </div>
          </div>
        </form>
        {message.text && (
          <p className={`mt-2 text-sm ${message.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
            {message.text}
          </p>
        )}
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase">Key</th>
              <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase">Value</th>
              <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase">Last Updated</th>
              <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading ? (
              <tr>
                <td colSpan={4} className="px-6 py-4 text-center text-gray-500">Loading policies...</td>
              </tr>
            ) : policies.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-6 py-4 text-center text-gray-500">No policies defined</td>
              </tr>
            ) : (
              policies.map((policy) => (
                <tr key={policy.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">{policy.key}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{policy.value}</td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {new Date(policy.updatedAt).toLocaleString()}
                  </td>
                  <td className="px-6 py-4 text-right text-sm font-medium">
                    <button 
                      onClick={() => setNewPolicy({ key: policy.key, value: policy.value })}
                      className="text-blue-600 hover:text-blue-900 mr-4"
                    >
                      Edit
                    </button>
                    <button 
                      onClick={() => handleDeletePolicy(policy.key)}
                      className="text-red-600 hover:text-red-900"
                    >
                      Delete
                    </button>
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
