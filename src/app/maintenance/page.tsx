'use client';

import { useEffect, useState } from 'react';
import { Wrench, RefreshCw } from 'lucide-react';

export default function MaintenancePage() {
  const [message, setMessage] = useState('We are currently undergoing scheduled maintenance. Please check back soon.');
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    fetchStatus();
  }, []);

  async function fetchStatus() {
    try {
      const res = await fetch('/api/maintenance/status');
      if (res.ok) {
        const data = await res.json();
        if (!data.enabled) {
          // Maintenance is over, redirect to home
          window.location.href = '/slots';
          return;
        }
        if (data.message) {
          setMessage(data.message);
        }
      }
    } catch {
      // ignore
    }
  }

  async function handleRetry() {
    setChecking(true);
    try {
      const res = await fetch('/api/maintenance/status');
      if (res.ok) {
        const data = await res.json();
        if (!data.enabled) {
          window.location.href = '/slots';
          return;
        }
      }
    } catch {
      // ignore
    }
    setChecking(false);
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0a1628] via-[#132240] to-[#0d1f3c] flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center">
        <div className="bg-white/[0.04] backdrop-blur-sm rounded-2xl border border-white/[0.08] p-8">
          <div className="w-16 h-16 rounded-2xl bg-amber-500/10 flex items-center justify-center mx-auto mb-6">
            <Wrench className="w-8 h-8 text-amber-400" />
          </div>

          <h1 className="text-2xl font-bold text-white mb-3">Under Maintenance</h1>

          <p className="text-slate-400 text-sm leading-relaxed mb-6">
            {message}
          </p>

          <button
            onClick={handleRetry}
            disabled={checking}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-accent hover:bg-accent-light text-primary rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${checking ? 'animate-spin' : ''}`} />
            {checking ? 'Checking...' : 'Check Again'}
          </button>
        </div>

        <p className="text-slate-600 text-xs mt-4">Ankeet Bawane Cricket Academy</p>
      </div>
    </div>
  );
}
