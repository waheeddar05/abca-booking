'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { Package, Loader2, ShoppingCart, CheckCircle, Clock, AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { differenceInDays, startOfDay } from 'date-fns';

interface PackageInfo {
  id: string;
  name: string;
  machineType: string;
  ballType: string;
  wicketType: string;
  timingType: string;
  totalSessions: number;
  validityDays: number;
  price: number;
}

interface MyPackage {
  id: string;
  packageName: string;
  machineType: string;
  ballType: string;
  wicketType: string;
  timingType: string;
  totalSessions: number;
  usedSessions: number;
  remainingSessions: number;
  activationDate: string;
  expiryDate: string;
  status: string;
  amountPaid: number;
  totalExtraPayments: number;
  bookingHistory: Array<{
    id: string;
    sessionsUsed: number;
    extraCharge: number;
    booking: { date: string; startTime: string; endTime: string; status: string };
  }>;
}

const labelMap: Record<string, string> = {
  LEATHER: 'Leather', TENNIS: 'Tennis', MACHINE: 'Machine Ball',
  BOTH: 'Both', CEMENT: 'Cement', ASTRO: 'Astro',
  DAY: 'Day', EVENING: 'Evening/Night',
};

export default function PackagesPage() {
  const { data: session } = useSession();
  const [tab, setTab] = useState<'browse' | 'my'>('my');
  const [packages, setPackages] = useState<PackageInfo[]>([]);
  const [myPackages, setMyPackages] = useState<MyPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [message, setMessage] = useState({ text: '', type: '' });

  const fetchPackages = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/packages');
      if (res.ok) setPackages(await res.json());
    } catch (e) {
      console.error('Failed to fetch packages', e);
    } finally {
      setLoading(false);
    }
  };

  const fetchMyPackages = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/packages/my');
      if (res.ok) setMyPackages(await res.json());
    } catch (e) {
      console.error('Failed to fetch my packages', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (session) {
      fetchPackages();
      fetchMyPackages();
    } else {
      fetchPackages();
    }
  }, [session]);

  useEffect(() => {
    if (tab === 'my' && session) fetchMyPackages();
    if (tab === 'browse') fetchPackages();
  }, [tab, session]);

  const handlePurchase = async (packageId: string) => {
    if (!session) {
      setMessage({ text: 'Please login to purchase a package', type: 'error' });
      return;
    }
    if (!confirm('Confirm package purchase?')) return;
    setPurchasing(packageId);
    setMessage({ text: '', type: '' });
    try {
      const res = await fetch('/api/packages/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageId }),
      });
      if (res.ok) {
        setMessage({ text: 'Package purchased successfully!', type: 'success' });
        setTab('my');
      } else {
        const data = await res.json();
        setMessage({ text: data.error || 'Purchase failed', type: 'error' });
      }
    } catch {
      setMessage({ text: 'Internal server error', type: 'error' });
    } finally {
      setPurchasing(null);
    }
  };

  return (
    <div className="min-h-[calc(100vh-56px)]">
      <div className="fixed inset-0 -z-10 bg-gradient-to-br from-[#0a1628] via-[#132240] to-[#0d1f3c]"></div>
      <div className="fixed inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,rgba(212,168,67,0.05),transparent_60%)]"></div>

      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-xl font-bold text-white">Packages</h1>
          {session && (
            <div className="flex gap-2">
              <button
                onClick={() => setTab('my')}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                  tab === 'my' ? 'bg-accent/15 text-accent' : 'text-slate-400 hover:bg-white/[0.06]'
                }`}
              >
                <Package className="w-3.5 h-3.5 inline mr-1" />
                My Packages
              </button>
              <button
                onClick={() => setTab('browse')}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                  tab === 'browse' ? 'bg-accent/15 text-accent' : 'text-slate-400 hover:bg-white/[0.06]'
                }`}
              >
                <ShoppingCart className="w-3.5 h-3.5 inline mr-1" />
                Browse
              </button>
            </div>
          )}
        </div>

        {message.text && (
          <p className={`mb-4 text-sm ${message.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
            {message.text}
          </p>
        )}

        {/* CONTENT AREA */}
        <div className="flex flex-col md:flex-row gap-6">
          {/* Left Side: My Packages (now default) */}
          <div className={`flex-1 ${tab === 'my' ? 'block' : 'hidden md:block'}`}>
            <h2 className="text-sm font-semibold text-slate-400 mb-4 flex items-center gap-2">
              <Package className="w-4 h-4" />
              My Packages
            </h2>
            {loading && tab === 'my' ? (
              <div className="flex items-center justify-center py-12 text-slate-400">
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                <span className="text-sm">Loading your packages...</span>
              </div>
            ) : myPackages.length === 0 ? (
              <div className="bg-white/[0.02] border border-white/[0.05] rounded-xl p-8 text-center">
                <Package className="w-8 h-8 text-slate-600 mx-auto mb-3" />
                <p className="text-sm text-slate-500">No active packages found</p>
              </div>
            ) : (
              <div className="space-y-4">
                {myPackages.map(up => {
                  const remaining = up.totalSessions - up.usedSessions;
                  const pct = up.totalSessions > 0 ? (up.usedSessions / up.totalSessions) * 100 : 0;
                  const isActive = up.status === 'ACTIVE';
                  const isExpired = up.status === 'EXPIRED';
                  
                  // Calculate days remaining
                  const today = startOfDay(new Date());
                  const expiry = startOfDay(new Date(up.expiryDate));
                  const daysRemaining = differenceInDays(expiry, today);

                  return (
                    <div key={up.id} className="bg-white/[0.04] backdrop-blur-sm rounded-xl border border-white/[0.08] p-5">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="text-sm font-semibold text-white">{up.packageName}</h3>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                              isActive ? 'bg-green-500/15 text-green-400' :
                              isExpired ? 'bg-red-500/15 text-red-400' :
                              'bg-slate-500/15 text-slate-400'
                            }`}>
                              {up.status}
                            </span>
                          </div>
                          <div className="flex flex-col gap-1 text-[11px] text-slate-400">
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {isExpired ? (
                                `Expired on ${new Date(up.expiryDate).toLocaleDateString()}`
                              ) : daysRemaining <= 0 ? (
                                "Expires today"
                              ) : (
                                `${daysRemaining} day${daysRemaining === 1 ? '' : 's'} remaining`
                              )}
                            </span>
                          </div>
                        </div>
                        {isActive && remaining > 0 && (
                          <Link
                            href="/slots"
                            className="bg-accent hover:bg-accent-light text-primary px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors"
                          >
                            Book
                          </Link>
                        )}
                      </div>

                      <div className="mb-0">
                        <div className="flex justify-between text-[10px] mb-1">
                          <span className="text-slate-500">Usage</span>
                          <span className="text-white">{up.usedSessions}/{up.totalSessions}</span>
                        </div>
                        <div className="w-full bg-white/[0.06] rounded-full h-1.5">
                          <div
                            className={`h-1.5 rounded-full transition-all ${pct >= 100 ? 'bg-red-500' : pct >= 75 ? 'bg-yellow-500' : 'bg-accent'}`}
                            style={{ width: `${Math.min(pct, 100)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right Side: Browse Packages */}
          <div className={`flex-1 ${tab === 'browse' ? 'block' : 'hidden'}`}>
            <h2 className="text-sm font-semibold text-slate-400 mb-4 flex items-center gap-2">
              <ShoppingCart className="w-4 h-4" />
              Available Packages
            </h2>
            {loading && tab === 'browse' ? (
              <div className="flex items-center justify-center py-12 text-slate-400">
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                <span className="text-sm">Loading available packages...</span>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {packages.map(pkg => (
                  <div key={pkg.id} className="bg-white/[0.04] backdrop-blur-sm rounded-xl border border-white/[0.08] p-5 flex flex-col">
                    <div className="flex justify-between items-start mb-2">
                      <h3 className="text-sm font-semibold text-white">{pkg.name}</h3>
                      <span className="text-accent font-bold text-sm">₹{pkg.price}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-[10px] text-slate-400 mb-3">
                      <span className="bg-white/[0.06] px-2 py-0.5 rounded">{labelMap[pkg.machineType]}</span>
                      <span className="bg-white/[0.06] px-2 py-0.5 rounded">{pkg.totalSessions} Sessions</span>
                      <span className="bg-white/[0.06] px-2 py-0.5 rounded">{pkg.validityDays} Days</span>
                    </div>
                    <button
                      onClick={() => handlePurchase(pkg.id)}
                      disabled={purchasing === pkg.id}
                      className="w-full bg-accent hover:bg-accent-light text-primary py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                    >
                      {purchasing === pkg.id ? <Loader2 className="w-3.5 h-3.5 animate-spin mx-auto" /> : 'Purchase Now'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
