'use client';

import { useState, useEffect } from 'react';
import { Settings, Save, Pencil, Trash2, Loader2, HelpCircle } from 'lucide-react';

export default function PolicyManagement() {
  const [policies, setPolicies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newPolicy, setNewPolicy] = useState({ key: '', value: '' });
  const [message, setMessage] = useState({ text: '', type: '' });
  const [showHelp, setShowHelp] = useState(false);

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
        setMessage({ text: 'Policy saved successfully', type: 'success' });
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
    if (!confirm(`Delete policy "${key}"?`)) return;
    setMessage({ text: '', type: '' });
    try {
      const res = await fetch(`/api/admin/policies?key=${encodeURIComponent(key)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setMessage({ text: 'Policy deleted', type: 'success' });
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
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-bold text-white">Policies</h1>
        <button
          onClick={() => setShowHelp(!showHelp)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-400 hover:bg-white/[0.06] rounded-lg transition-colors cursor-pointer"
        >
          <HelpCircle className="w-3.5 h-3.5" />
          Help
        </button>
      </div>

      {/* Help Panel */}
      {showHelp && (
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 mb-5 text-sm">
          <h3 className="font-semibold text-blue-300 mb-2">Available Policy Keys</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-blue-300">
            <div>
              <p className="font-medium mb-1">Timing:</p>
              <ul className="space-y-1 text-xs">
                <li><code className="bg-blue-500/20 px-1.5 py-0.5 rounded">SLOT_WINDOW_START</code> - Start hour (e.g. 7)</li>
                <li><code className="bg-blue-500/20 px-1.5 py-0.5 rounded">SLOT_WINDOW_END</code> - End hour (e.g. 22)</li>
                <li><code className="bg-blue-500/20 px-1.5 py-0.5 rounded">SLOT_DURATION</code> - Minutes per slot (e.g. 30)</li>
              </ul>
            </div>
            <div>
              <p className="font-medium mb-1">Other:</p>
              <ul className="space-y-1 text-xs">
                <li><code className="bg-blue-500/20 px-1.5 py-0.5 rounded">DISABLED_DATES</code> - Comma-separated dates</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Create/Update Form */}
      <div className="bg-white/[0.04] backdrop-blur-sm rounded-xl border border-white/[0.08] p-5 mb-5">
        <h2 className="text-sm font-semibold text-white mb-3">
          {newPolicy.key ? 'Update Policy' : 'Create Policy'}
        </h2>
        <form onSubmit={handleUpdatePolicy} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Key</label>
              <input
                type="text"
                placeholder="e.g. SLOT_DURATION"
                value={newPolicy.key}
                onChange={(e) => setNewPolicy({ ...newPolicy, key: e.target.value })}
                required
                className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 placeholder:text-slate-500"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Value</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Enter value"
                  value={newPolicy.value}
                  onChange={(e) => setNewPolicy({ ...newPolicy, value: e.target.value })}
                  required
                  className="flex-1 bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 placeholder:text-slate-500"
                />
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 bg-accent hover:bg-accent-light text-primary px-5 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer"
                >
                  <Save className="w-4 h-4" />
                  <span className="hidden sm:inline">Save</span>
                </button>
              </div>
            </div>
          </div>
        </form>
        {message.text && (
          <p className={`mt-3 text-sm ${message.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
            {message.text}
          </p>
        )}
      </div>

      {/* Policy List */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          <span className="text-sm">Loading policies...</span>
        </div>
      ) : policies.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-12 h-12 rounded-full bg-white/[0.04] flex items-center justify-center mx-auto mb-3">
            <Settings className="w-5 h-5 text-slate-500" />
          </div>
          <p className="text-sm text-slate-400">No policies defined yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {policies.map((policy) => (
            <div key={policy.id} className="bg-white/[0.04] backdrop-blur-sm rounded-xl border border-white/[0.08] p-4 flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-0.5">
                  <code className="text-sm font-semibold text-white">{policy.key}</code>
                </div>
                <p className="text-sm text-slate-400 truncate">{policy.value}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Updated {new Date(policy.updatedAt).toLocaleString()}
                </p>
              </div>
              <div className="flex items-center gap-1 ml-3">
                <button
                  onClick={() => setNewPolicy({ key: policy.key, value: policy.value })}
                  className="p-2 text-slate-400 hover:text-accent hover:bg-accent/10 rounded-lg transition-colors cursor-pointer"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDeletePolicy(policy.key)}
                  className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
