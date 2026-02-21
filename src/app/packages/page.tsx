'use client';

import { useState, useEffect, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { Package, Loader2, ShoppingCart, Clock, X, ChevronRight } from 'lucide-react';
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
  LEATHER: 'Leather Ball', TENNIS: 'Tennis', MACHINE: 'Machine Ball',
  BOTH: 'Both', CEMENT: 'Cement', ASTRO: 'Astro',
  DAY: 'Day (7:00 AM – 5:00 PM)', EVENING: 'Evening/Night (7:00 PM – 10:30 PM)',
};

type MachineFilter = 'all' | 'GRAVITY' | 'YANTRA' | 'LEVERAGE_INDOOR' | 'LEVERAGE_OUTDOOR';

const MACHINE_CARDS = [
  { id: 'GRAVITY' as MachineFilter, label: 'Gravity', shortLabel: 'Leather', category: 'LEATHER', image: '/images/leathermachine.jpeg' },
  { id: 'YANTRA' as MachineFilter, label: 'Yantra', shortLabel: 'Premium Leather', category: 'LEATHER', image: '/images/yantra-machine.jpeg' },
  { id: 'LEVERAGE_INDOOR' as MachineFilter, label: 'Leverage Tennis', shortLabel: 'Indoor', category: 'TENNIS', image: '/images/tennismachine.jpeg' },
  { id: 'LEVERAGE_OUTDOOR' as MachineFilter, label: 'Leverage Tennis', shortLabel: 'Outdoor', category: 'TENNIS', image: '/images/tennismachine.jpeg' },
];

export default function PackagesPage() {
  const { data: session } = useSession();
  const [tab, setTab] = useState<'browse' | 'my'>('my');
  const [packages, setPackages] = useState<PackageInfo[]>([]);
  const [myPackages, setMyPackages] = useState<MyPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [message, setMessage] = useState({ text: '', type: '' });
  const [machineFilter, setMachineFilter] = useState<MachineFilter>('all');
  const [timingFilter, setTimingFilter] = useState<'DAY' | 'EVENING' | ''>('');
  const [selectedPackage, setSelectedPackage] = useState<PackageInfo | null>(null);

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

  // Filtered packages based on machine card + timing selection
  const filteredPackages = useMemo(() => {
    let filtered = packages;
    if (machineFilter !== 'all') {
      const card = MACHINE_CARDS.find(c => c.id === machineFilter);
      if (card) {
        filtered = filtered.filter(pkg => pkg.machineType === card.category);
      }
    }
    if (timingFilter) {
      filtered = filtered.filter(pkg => pkg.timingType === timingFilter);
    }
    return filtered;
  }, [packages, machineFilter, timingFilter]);

  const leatherPackages = filteredPackages.filter(p => p.machineType === 'LEATHER');
  const tennisPackages = filteredPackages.filter(p => p.machineType === 'TENNIS');

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

        {/* MY PACKAGES TAB */}
        {tab === 'my' && (
          <div>
            <h2 className="text-sm font-semibold text-slate-400 mb-4 flex items-center gap-2">
              <Package className="w-4 h-4" />
              My Packages
            </h2>
            {loading ? (
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
        )}

        {/* BROWSE PACKAGES TAB */}
        {tab === 'browse' && (
          <div>
            {/* Machine Selection - 4 boxes like /slots page */}
            <div className="mb-5">
              <label className="block text-xs font-bold text-white mb-2 uppercase tracking-wider">
                Select Machine
              </label>
              <div className="grid grid-cols-2 gap-2">
                {MACHINE_CARDS.map((card) => {
                  const isSelected = machineFilter === card.id;
                  return (
                    <button
                      key={card.id}
                      onClick={() => { setMachineFilter(isSelected ? 'all' : card.id); setTimingFilter(''); }}
                      className={`flex items-center gap-2.5 px-2.5 py-2 rounded-xl transition-all cursor-pointer text-left ${
                        isSelected
                          ? 'bg-accent/15 ring-2 ring-accent/50 shadow-sm'
                          : 'bg-white/[0.04] border border-white/[0.08] hover:border-accent/30'
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={card.image}
                        alt={card.label}
                        className="w-9 h-9 rounded-lg object-cover flex-shrink-0"
                      />
                      <div className="min-w-0">
                        <span className={`text-[11px] font-bold truncate block ${isSelected ? 'text-accent' : 'text-slate-300'}`}>
                          {card.label}
                        </span>
                        <p className={`text-[9px] ${isSelected ? 'text-accent/70' : 'text-slate-600'}`}>
                          {card.shortLabel}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Day / Evening Selector - shown when a machine is selected */}
            {machineFilter !== 'all' && (
              <div className="mb-5">
                <label className="block text-[10px] font-bold text-slate-400 mb-2 uppercase tracking-wider">
                  Timing
                </label>
                <div className="flex gap-2">
                  {([
                    { key: 'DAY' as const, label: 'Day', sub: '7:00 AM – 5:00 PM' },
                    { key: 'EVENING' as const, label: 'Evening', sub: '7:00 PM – 10:30 PM' },
                  ]).map(t => (
                    <button
                      key={t.key}
                      onClick={() => setTimingFilter(timingFilter === t.key ? '' : t.key)}
                      className={`flex-1 px-3 py-2.5 rounded-xl text-center transition-all cursor-pointer ${
                        timingFilter === t.key
                          ? 'bg-accent/15 ring-2 ring-accent/50 shadow-sm'
                          : 'bg-white/[0.04] border border-white/[0.08] hover:border-accent/30'
                      }`}
                    >
                      <span className={`text-xs font-bold block ${timingFilter === t.key ? 'text-accent' : 'text-slate-300'}`}>
                        {t.label}
                      </span>
                      <span className={`text-[9px] ${timingFilter === t.key ? 'text-accent/70' : 'text-slate-600'}`}>
                        {t.sub}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {loading ? (
              <div className="flex items-center justify-center py-12 text-slate-400">
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                <span className="text-sm">Loading available packages...</span>
              </div>
            ) : filteredPackages.length === 0 ? (
              <div className="bg-white/[0.02] border border-white/[0.05] rounded-xl p-8 text-center">
                <Package className="w-8 h-8 text-slate-600 mx-auto mb-3" />
                <p className="text-sm text-slate-500">No packages found for this filter</p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Leather Machines Section */}
                {(machineFilter === 'all' || MACHINE_CARDS.find(c => c.id === machineFilter)?.category === 'LEATHER') && leatherPackages.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="w-2.5 h-2.5 rounded-full bg-red-500"></span>
                      <h3 className="text-sm font-bold text-white">Leather Ball Machines</h3>
                      <span className="text-[10px] text-slate-500 bg-white/[0.04] px-2 py-0.5 rounded-full">{leatherPackages.length}</span>
                    </div>
                    <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] overflow-hidden">
                      {/* Table Header */}
                      <div className="hidden sm:grid grid-cols-[1fr_100px_80px_80px_100px_90px] gap-2 px-4 py-2.5 bg-white/[0.03] border-b border-white/[0.06]">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Package</span>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Ball Type</span>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Sessions</span>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Validity</span>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Price</span>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider"></span>
                      </div>
                      {leatherPackages.map((pkg, idx) => (
                        <div
                          key={pkg.id}
                          className={`sm:grid sm:grid-cols-[1fr_100px_80px_80px_100px_90px] gap-2 px-4 py-3.5 items-center hover:bg-white/[0.03] transition-colors ${
                            idx < leatherPackages.length - 1 ? 'border-b border-white/[0.04]' : ''
                          }`}
                        >
                          <div
                            className="cursor-pointer"
                            onClick={() => setSelectedPackage(pkg)}
                          >
                            <span className="text-sm font-semibold text-white hover:text-accent transition-colors">{pkg.name}</span>
                            <div className="text-[10px] text-slate-500 mt-0.5">
                              {pkg.timingType === 'DAY' ? 'Day' : 'Evening/Night'}
                            </div>
                          </div>
                          <div className="text-xs text-slate-400 mt-1 sm:mt-0">
                            <span className="sm:hidden text-[10px] text-slate-500">Ball: </span>
                            {labelMap[pkg.ballType] || pkg.ballType}
                          </div>
                          <div className="text-xs text-white font-medium mt-1 sm:mt-0">
                            <span className="sm:hidden text-[10px] text-slate-500">Sessions: </span>
                            {pkg.totalSessions}
                          </div>
                          <div className="text-xs text-slate-400 mt-1 sm:mt-0">
                            <span className="sm:hidden text-[10px] text-slate-500">Validity: </span>
                            {pkg.validityDays}d
                          </div>
                          <div className="text-sm text-accent font-bold mt-1 sm:mt-0">
                            <span className="sm:hidden text-[10px] text-slate-500">Price: </span>
                            ₹{pkg.price}
                          </div>
                          <div className="flex items-center gap-2 mt-2 sm:mt-0">
                            <button
                              onClick={() => handlePurchase(pkg.id)}
                              disabled={purchasing === pkg.id}
                              className="bg-accent hover:bg-accent-light text-primary px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                            >
                              {purchasing === pkg.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Buy'}
                            </button>
                            <button
                              onClick={() => setSelectedPackage(pkg)}
                              className="p-1.5 text-slate-400 hover:text-accent hover:bg-accent/10 rounded-lg transition-colors cursor-pointer"
                            >
                              <ChevronRight className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Tennis Machines Section */}
                {(machineFilter === 'all' || MACHINE_CARDS.find(c => c.id === machineFilter)?.category === 'TENNIS') && tennisPackages.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="w-2.5 h-2.5 rounded-full bg-green-500"></span>
                      <h3 className="text-sm font-bold text-white">Tennis Machines</h3>
                      <span className="text-[10px] text-slate-500 bg-white/[0.04] px-2 py-0.5 rounded-full">{tennisPackages.length}</span>
                    </div>
                    <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] overflow-hidden">
                      {/* Table Header */}
                      <div className="hidden sm:grid grid-cols-[1fr_80px_80px_100px_90px] gap-2 px-4 py-2.5 bg-white/[0.03] border-b border-white/[0.06]">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Package</span>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Sessions</span>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Validity</span>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Price</span>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider"></span>
                      </div>
                      {tennisPackages.map((pkg, idx) => (
                        <div
                          key={pkg.id}
                          className={`sm:grid sm:grid-cols-[1fr_80px_80px_100px_90px] gap-2 px-4 py-3.5 items-center hover:bg-white/[0.03] transition-colors ${
                            idx < tennisPackages.length - 1 ? 'border-b border-white/[0.04]' : ''
                          }`}
                        >
                          <div
                            className="cursor-pointer"
                            onClick={() => setSelectedPackage(pkg)}
                          >
                            <span className="text-sm font-semibold text-white hover:text-accent transition-colors">{pkg.name}</span>
                            <div className="text-[10px] text-slate-500 mt-0.5">
                              {pkg.timingType === 'DAY' ? 'Day' : 'Evening/Night'}
                            </div>
                          </div>
                          <div className="text-xs text-white font-medium mt-1 sm:mt-0">
                            <span className="sm:hidden text-[10px] text-slate-500">Sessions: </span>
                            {pkg.totalSessions}
                          </div>
                          <div className="text-xs text-slate-400 mt-1 sm:mt-0">
                            <span className="sm:hidden text-[10px] text-slate-500">Validity: </span>
                            {pkg.validityDays}d
                          </div>
                          <div className="text-sm text-accent font-bold mt-1 sm:mt-0">
                            <span className="sm:hidden text-[10px] text-slate-500">Price: </span>
                            ₹{pkg.price}
                          </div>
                          <div className="flex items-center gap-2 mt-2 sm:mt-0">
                            <button
                              onClick={() => handlePurchase(pkg.id)}
                              disabled={purchasing === pkg.id}
                              className="bg-accent hover:bg-accent-light text-primary px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                            >
                              {purchasing === pkg.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Buy'}
                            </button>
                            <button
                              onClick={() => setSelectedPackage(pkg)}
                              className="p-1.5 text-slate-400 hover:text-accent hover:bg-accent/10 rounded-lg transition-colors cursor-pointer"
                            >
                              <ChevronRight className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Package Detail Modal */}
      {selectedPackage && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedPackage(null)}
        >
          <div
            className="bg-[#0f1d2f] border border-white/[0.12] rounded-2xl w-full max-w-md p-6 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-5">
              <div>
                <h2 className="text-lg font-bold text-white">{selectedPackage.name}</h2>
                <span className={`inline-block mt-1 text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                  selectedPackage.machineType === 'LEATHER'
                    ? 'bg-red-500/15 text-red-400'
                    : 'bg-green-500/15 text-green-400'
                }`}>
                  {selectedPackage.machineType === 'LEATHER' ? 'Leather Ball Machine' : 'Tennis Machine'}
                </span>
              </div>
              <button
                onClick={() => setSelectedPackage(null)}
                className="p-2 text-slate-400 hover:text-white hover:bg-white/[0.06] rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Details Grid */}
              <div className="grid grid-cols-2 gap-3">
                <DetailItem label="Machine" value={selectedPackage.machineType === 'LEATHER' ? 'Leather Ball' : 'Tennis'} />
                {selectedPackage.machineType === 'LEATHER' && (
                  <DetailItem label="Ball Type" value={labelMap[selectedPackage.ballType] || selectedPackage.ballType} />
                )}
                <DetailItem
                  label="Timing"
                  value={selectedPackage.timingType === 'DAY' ? 'Day' : selectedPackage.timingType === 'EVENING' ? 'Evening/Night' : 'Both'}
                  subValue={selectedPackage.timingType === 'DAY' ? '7:00 AM – 5:00 PM' : selectedPackage.timingType === 'EVENING' ? '7:00 PM – 10:30 PM' : 'Any time'}
                />
                <DetailItem label="Sessions" value={`${selectedPackage.totalSessions} sessions`} />
                <DetailItem label="Validity" value={`${selectedPackage.validityDays} days`} />
                <DetailItem label="Price" value={`₹${selectedPackage.price}`} highlight />
              </div>

              {/* Purchase Button */}
              <button
                onClick={() => { handlePurchase(selectedPackage.id); setSelectedPackage(null); }}
                disabled={purchasing === selectedPackage.id}
                className="w-full bg-accent hover:bg-accent-light text-primary py-3 rounded-xl text-sm font-bold transition-colors disabled:opacity-50 cursor-pointer mt-2"
              >
                {purchasing === selectedPackage.id ? (
                  <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                ) : (
                  `Purchase for ₹${selectedPackage.price}`
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailItem({ label, value, subValue, highlight }: {
  label: string;
  value: string;
  subValue?: string;
  highlight?: boolean;
}) {
  return (
    <div className="bg-white/[0.04] rounded-lg p-3">
      <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-sm font-semibold ${highlight ? 'text-accent' : 'text-white'}`}>{value}</div>
      {subValue && <div className="text-[10px] text-slate-500 mt-0.5">{subValue}</div>}
    </div>
  );
}
