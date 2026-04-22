'use client';

import { useState, useEffect, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { Package, Loader2, ShoppingCart, Clock, X, ChevronRight, RotateCcw, Sun, Moon, Zap, Calendar, CreditCard } from 'lucide-react';
import Link from 'next/link';
import { differenceInDays, startOfDay } from 'date-fns';
import { useRazorpay, usePaymentConfig } from '@/lib/useRazorpay';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { LABEL_MAP } from '@/lib/client-constants';
import { ContactFooter } from '@/components/ContactFooter';
import { PackageFirstBookingBanner } from '@/components/ui/PackageFirstBookingBanner';

import { Wallet } from 'lucide-react';

interface PackageInfo {
  id: string;
  name: string;
  machineId: string | null;
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
  pitchTypes?: string[];
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

const labelMap = LABEL_MAP;

type MachineFilter = 'all' | 'GRAVITY' | 'YANTRA' | 'LEVERAGE_INDOOR' | 'LEVERAGE_OUTDOOR';

const PACKAGE_MACHINE_CARDS: { id: MachineFilter; label: string; sub: string; category: string; image: string; dot: string }[] = [
  { id: 'GRAVITY', label: 'Gravity', sub: 'Leather', category: 'LEATHER', image: '/images/leathermachine.jpeg', dot: 'bg-red-500' },
  { id: 'YANTRA', label: 'Yantra', sub: 'Premium Leather', category: 'LEATHER', image: '/images/yantra-machine.jpeg', dot: 'bg-red-500' },
  { id: 'LEVERAGE_INDOOR', label: 'Leverage Tennis', sub: 'Indoor', category: 'TENNIS', image: '/images/tennismachine.jpeg', dot: 'bg-green-500' },
  { id: 'LEVERAGE_OUTDOOR', label: 'Leverage Tennis', sub: 'Outdoor', category: 'TENNIS', image: '/images/tennismachine.jpeg', dot: 'bg-green-500' },
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
  const [confirmPurchaseId, setConfirmPurchaseId] = useState<string | null>(null);
  const [useWalletForPkg, setUseWalletForPkg] = useState(false);
  const [walletBalance, setWalletBalance] = useState<number>(0);

  const { config: paymentConfig } = usePaymentConfig();
  const { initiatePayment, processing: paymentProcessing } = useRazorpay({
    onSuccess: () => {
      setMessage({ text: 'Package purchased successfully!', type: 'success' });
      setTab('my');
      fetchMyPackages();
    },
    onFailure: (error) => {
      setMessage({ text: error || 'Payment failed', type: 'error' });
    },
  }, paymentConfig?.paymentEnabled ?? false);

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
      // Fetch wallet balance
      if (paymentConfig?.walletEnabled) {
        fetch('/api/wallet')
          .then(res => res.json())
          .then(data => { if (data.balance != null) { setWalletBalance(data.balance); if (data.balance > 0) setUseWalletForPkg(true); } })
          .catch(() => {});
      }
    } else {
      fetchPackages();
    }
  }, [session, paymentConfig?.walletEnabled]);

  useEffect(() => {
    if (tab === 'my' && session) fetchMyPackages();
    if (tab === 'browse') fetchPackages();
  }, [tab, session]);

  const handlePurchase = async (packageId: string) => {
    if (!session) {
      setMessage({ text: 'Please login to purchase a package', type: 'error' });
      return;
    }

    const pkg = packages.find(p => p.id === packageId);
    if (!pkg) return;

    const walletDeduction = useWalletForPkg && walletBalance > 0 ? Math.min(walletBalance, pkg.price) : 0;
    const amountAfterWallet = pkg.price - walletDeduction;

    // If payment is enabled and required for packages
    if (paymentConfig?.paymentEnabled && paymentConfig?.packagePaymentRequired) {
      // If wallet covers full amount, do wallet-only purchase
      if (walletDeduction > 0 && amountAfterWallet === 0) {
        setPurchasing(packageId);
        setMessage({ text: '', type: '' });
        try {
          const res = await fetch('/api/packages/purchase', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ packageId, paymentMethod: 'WALLET', walletDeduction }),
          });
          if (res.ok) {
            setMessage({ text: 'Package purchased using wallet balance!', type: 'success' });
            setTab('my');
            setUseWalletForPkg(false);
            setWalletBalance(prev => prev - walletDeduction);
            fetchMyPackages();
          } else {
            const data = await res.json();
            setMessage({ text: data.error || 'Purchase failed', type: 'error' });
          }
        } catch {
          setMessage({ text: 'Internal server error', type: 'error' });
        } finally {
          setPurchasing(null);
        }
        return;
      }

      // Razorpay payment (possibly with partial wallet deduction)
      setPurchasing(packageId);
      setMessage({ text: '', type: '' });

      await initiatePayment({
        type: 'PACKAGE_PURCHASE',
        amount: amountAfterWallet,
        packageId,
        description: `Package: ${pkg.name} (${pkg.totalSessions} sessions)${walletDeduction > 0 ? ` | ₹${walletDeduction} from wallet` : ''}`,
        prefill: {
          name: session.user?.name || undefined,
          email: session.user?.email || undefined,
        },
        walletDeduction: walletDeduction > 0 ? walletDeduction : undefined,
      });

      if (walletDeduction > 0) {
        setWalletBalance(prev => prev - walletDeduction);
        setUseWalletForPkg(false);
      }

      setPurchasing(null);
      return;
    }

    // Fallback: free/offline purchase — show confirm dialog
    setConfirmPurchaseId(packageId);
    return;
  };

  const handleConfirmPurchase = async () => {
    const packageId = confirmPurchaseId;
    if (!packageId) return;
    setConfirmPurchaseId(null);
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
        fetchMyPackages();
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

  const hasActiveFilter = machineFilter !== 'all' || timingFilter !== '';

  const clearFilters = () => {
    setMachineFilter('all');
    setTimingFilter('');
  };

  // Filtered packages based on machine card + timing
  const filteredPackages = useMemo(() => {
    let filtered = packages;
    if (machineFilter !== 'all') {
      const card = PACKAGE_MACHINE_CARDS.find(c => c.id === machineFilter);
      if (card) {
        // Filter by machineId if available, fallback to machineType category for older packages
        filtered = filtered.filter(pkg =>
          pkg.machineId ? pkg.machineId === machineFilter : pkg.machineType === card.category
        );
      }
    }
    if (timingFilter) {
      filtered = filtered.filter(pkg => pkg.timingType === timingFilter || pkg.timingType === 'BOTH');
    }
    return filtered;
  }, [packages, machineFilter, timingFilter]);

  const leatherPackages = filteredPackages.filter(p => p.machineType === 'LEATHER');
  const tennisPackages = filteredPackages.filter(p => p.machineType === 'TENNIS');

  const getTimingLabel = (t: string) => {
    if (t === 'DAY') return 'Day';
    if (t === 'EVENING') return 'Evening/Night';
    if (t === 'BOTH') return 'Day & Evening';
    return t;
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
                <p className="text-sm text-slate-400 mb-3">No active packages found</p>
                <button
                  onClick={() => setTab('browse')}
                  className="text-xs text-accent hover:text-accent-light transition-colors cursor-pointer"
                >
                  Browse available packages →
                </button>
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
                  const isFirstBookingPending = isActive && up.usedSessions === 0;

                  return (
                    <div key={up.id}>
                    {isFirstBookingPending && (
                      <PackageFirstBookingBanner packageName={up.packageName} />
                    )}
                    <div className="bg-white/[0.04] backdrop-blur-sm rounded-xl border border-white/[0.08] p-5">
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
                              {(up as any).pendingActivation ? (
                                'Pending activation — starts on first booking'
                              ) : isExpired ? (
                                `Expired on ${new Date(up.expiryDate).toLocaleDateString()}`
                              ) : daysRemaining <= 0 ? (
                                "Expires today"
                              ) : (
                                `${daysRemaining} day${daysRemaining === 1 ? '' : 's'} remaining`
                              )}
                            </span>
                            {(() => {
                              const pitches = (up.pitchTypes && up.pitchTypes.length > 0)
                                ? up.pitchTypes
                                : (up.wicketType ? [up.wicketType] : []);
                              if (pitches.length === 0) return null;
                              return (
                                <span className="flex items-center gap-1">
                                  <span className="text-slate-500">Pitch:</span>
                                  <span className="text-slate-300">{pitches.map(p => labelMap[p] || p).join(', ')}</span>
                                </span>
                              );
                            })()}
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
                          <span className="text-slate-500">Sessions (Per Slot: 30 Min)</span>
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
            {/* ─── Filters Section ─── */}
            <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] p-4 mb-5">
              {/* Machine Type Filter */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Machine Type
                  </label>
                  {hasActiveFilter && (
                    <button
                      onClick={clearFilters}
                      className="inline-flex items-center gap-1 text-[10px] text-slate-500 hover:text-accent transition-colors cursor-pointer"
                    >
                      <RotateCcw className="w-3 h-3" />
                      Clear filters
                    </button>
                  )}
                </div>
                {/* Leather Machines */}
                <div className="grid grid-cols-2 gap-1.5 mb-1.5">
                  {PACKAGE_MACHINE_CARDS.filter(c => c.category === 'LEATHER').map((card) => {
                    const isSelected = machineFilter === card.id;
                    return (
                      <button
                        key={card.id}
                        onClick={() => { setMachineFilter(isSelected ? 'all' : card.id); setTimingFilter(''); }}
                        className={`flex items-center gap-1.5 px-1.5 py-1 rounded-lg transition-all cursor-pointer text-left ${
                          isSelected
                            ? 'bg-accent/15 ring-1 ring-accent/50 shadow-sm'
                            : 'bg-white/[0.04] border border-white/[0.08] hover:border-accent/30'
                        }`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={card.image}
                          alt={card.label}
                          className="w-7 h-7 rounded-md object-cover flex-shrink-0"
                        />
                        <div className="min-w-0">
                          <span className={`text-[10px] font-bold leading-tight ${isSelected ? 'text-accent' : 'text-slate-300'}`}>
                            {card.label}
                          </span>
                          <p className={`text-[8px] ${isSelected ? 'text-accent/70' : 'text-slate-500'}`}>
                            {card.sub}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
                {/* Tennis Machines */}
                <div className="grid grid-cols-2 gap-1.5">
                  {PACKAGE_MACHINE_CARDS.filter(c => c.category === 'TENNIS').map((card) => {
                    const isSelected = machineFilter === card.id;
                    return (
                      <button
                        key={card.id}
                        onClick={() => { setMachineFilter(isSelected ? 'all' : card.id); setTimingFilter(''); }}
                        className={`flex items-center gap-1.5 px-1.5 py-1 rounded-lg transition-all cursor-pointer text-left ${
                          isSelected
                            ? 'bg-accent/15 ring-1 ring-accent/50 shadow-sm'
                            : 'bg-white/[0.04] border border-white/[0.08] hover:border-accent/30'
                        }`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={card.image}
                          alt={card.label}
                          className="w-7 h-7 rounded-md object-cover flex-shrink-0"
                        />
                        <div className="min-w-0">
                          <span className={`text-[10px] font-bold leading-tight ${isSelected ? 'text-accent' : 'text-slate-300'}`}>
                            {card.label}
                          </span>
                          <p className={`text-[8px] ${isSelected ? 'text-accent/70' : 'text-slate-500'}`}>
                            {card.sub}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Timing Filter */}
              <div>
                <label className="block text-[10px] font-bold text-slate-400 mb-2 uppercase tracking-wider">
                  Timing
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { key: 'DAY' as const, label: 'Day', sub: '7:00 AM – 5:00 PM', Icon: Sun },
                    { key: 'EVENING' as const, label: 'Evening / Night', sub: '7:00 PM – 10:30 PM', Icon: Moon },
                  ]).map(t => {
                    const isActive = timingFilter === t.key;
                    return (
                      <button
                        key={t.key}
                        onClick={() => setTimingFilter(isActive ? '' : t.key)}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded-lg transition-all cursor-pointer text-left ${
                          isActive
                            ? 'bg-accent/15 ring-1 ring-accent/50 shadow-sm'
                            : 'bg-white/[0.04] border border-white/[0.08] hover:border-accent/30'
                        }`}
                      >
                        <div className={`w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 ${
                          isActive ? 'bg-accent/20' : 'bg-white/[0.06]'
                        }`}>
                          <t.Icon className={`w-3.5 h-3.5 ${isActive ? 'text-accent' : 'text-slate-400'}`} />
                        </div>
                        <div className="min-w-0">
                          <span className={`text-[10px] font-bold block ${isActive ? 'text-accent' : 'text-slate-300'}`}>
                            {t.label}
                          </span>
                          <span className={`text-[8px] ${isActive ? 'text-accent/70' : 'text-slate-500'}`}>
                            {t.sub}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* ─── Package Results ─── */}
            {loading ? (
              <div className="flex items-center justify-center py-12 text-slate-400">
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                <span className="text-sm">Loading available packages...</span>
              </div>
            ) : filteredPackages.length === 0 ? (
              <div className="bg-white/[0.02] border border-white/[0.05] rounded-xl p-10 text-center">
                <Package className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                <p className="text-sm font-medium text-slate-400 mb-1">No packages found</p>
                <p className="text-xs text-slate-600 mb-4">
                  {hasActiveFilter ? 'Try adjusting your filters to see more packages' : 'No packages are currently available'}
                </p>
                {hasActiveFilter && (
                  <button
                    onClick={clearFilters}
                    className="inline-flex items-center gap-1.5 text-xs text-accent hover:text-accent-light transition-colors cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Clear all filters
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-5">
                {/* Leather Packages */}
                {leatherPackages.length > 0 && (
                  <PackageSection
                    title="Leather Ball Machines"
                    dotColor="bg-red-500"
                    count={leatherPackages.length}
                    packages={leatherPackages}
                    showBallType
                    purchasing={purchasing}
                    onPurchase={handlePurchase}
                    onSelect={setSelectedPackage}
                    getTimingLabel={getTimingLabel}
                  />
                )}

                {/* Tennis Packages */}
                {tennisPackages.length > 0 && (
                  <PackageSection
                    title="Tennis Machines"
                    dotColor="bg-green-500"
                    count={tennisPackages.length}
                    packages={tennisPackages}
                    showBallType={false}
                    purchasing={purchasing}
                    onPurchase={handlePurchase}
                    onSelect={setSelectedPackage}
                    getTimingLabel={getTimingLabel}
                  />
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Confirm Purchase Dialog */}
      <ConfirmDialog
        open={!!confirmPurchaseId}
        title="Confirm Purchase"
        message={`Purchase ${packages.find(p => p.id === confirmPurchaseId)?.name || 'this package'}?`}
        confirmLabel="Purchase"
        cancelLabel="Cancel"
        loading={!!purchasing}
        onConfirm={handleConfirmPurchase}
        onCancel={() => setConfirmPurchaseId(null)}
      />

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
                  {selectedPackage.machineId ? labelMap[selectedPackage.machineId] : (selectedPackage.machineType === 'LEATHER' ? 'Leather Ball Machine' : 'Tennis Machine')}
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
                <DetailItem label="Machine" value={selectedPackage.machineId ? labelMap[selectedPackage.machineId] : (selectedPackage.machineType === 'LEATHER' ? 'Leather Ball' : 'Tennis')} />
                {selectedPackage.machineType === 'LEATHER' && (
                  <DetailItem label="Ball Type" value={labelMap[selectedPackage.ballType] || selectedPackage.ballType} />
                )}
                <DetailItem
                  label="Timing"
                  value={getTimingLabel(selectedPackage.timingType)}
                  subValue={selectedPackage.timingType === 'DAY' ? '7:00 AM – 5:00 PM' : selectedPackage.timingType === 'EVENING' ? '7:00 PM – 10:30 PM' : 'Any time'}
                />
                <DetailItem label="Sessions (Per Slot: 30 Minutes)" value={`${selectedPackage.totalSessions} Sessions`} />
                <DetailItem label="Validity" value={`${selectedPackage.validityDays} Days Validity`} />
                <DetailItem label="Price" value={`₹${selectedPackage.price}`} highlight />
              </div>

              {/* Wallet Toggle */}
              {paymentConfig?.walletEnabled && paymentConfig?.paymentEnabled && paymentConfig?.packagePaymentRequired && walletBalance > 0 && (
                <button
                  type="button"
                  onClick={() => setUseWalletForPkg(!useWalletForPkg)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-all cursor-pointer ${
                    useWalletForPkg
                      ? 'border-green-500/50 bg-green-500/10'
                      : 'border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06]'
                  }`}
                >
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${useWalletForPkg ? 'bg-green-500/20' : 'bg-white/[0.06]'}`}>
                    <Wallet className={`w-4 h-4 ${useWalletForPkg ? 'text-green-400' : 'text-slate-400'}`} />
                  </div>
                  <div className="text-left flex-1">
                    <p className={`text-sm font-semibold ${useWalletForPkg ? 'text-green-400' : 'text-slate-300'}`}>
                      Use Wallet Balance
                    </p>
                    <p className="text-[10px] text-slate-500">
                      Available: ₹{walletBalance.toLocaleString()}
                      {useWalletForPkg && (
                        <span className="text-green-400 ml-1">
                          · Deducting ₹{Math.min(walletBalance, selectedPackage.price).toLocaleString()}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="ml-auto flex-shrink-0">
                    <div className={`w-10 h-6 rounded-full transition-colors relative ${useWalletForPkg ? 'bg-green-500' : 'bg-white/10'}`}>
                      <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${useWalletForPkg ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                    </div>
                  </div>
                </button>
              )}

              {/* Wallet covers full amount info */}
              {useWalletForPkg && walletBalance >= selectedPackage.price && (
                <div className="px-4 py-2.5 rounded-xl bg-green-500/5 border border-green-500/20">
                  <p className="text-xs text-green-400 font-medium">
                    ✓ Wallet balance covers the full amount. No additional payment needed.
                  </p>
                </div>
              )}

              {/* Purchase Button */}
              {(() => {
                const wd = useWalletForPkg && walletBalance > 0 ? Math.min(walletBalance, selectedPackage.price) : 0;
                const remaining = selectedPackage.price - wd;
                const isWalletOnly = wd > 0 && remaining === 0;
                const showPayAmount = paymentConfig?.paymentEnabled && paymentConfig?.packagePaymentRequired;

                return (
                  <button
                    onClick={() => { handlePurchase(selectedPackage.id); setSelectedPackage(null); }}
                    disabled={purchasing === selectedPackage.id || paymentProcessing}
                    className="w-full bg-accent hover:bg-accent-light text-primary py-3 rounded-xl text-sm font-bold transition-colors disabled:opacity-50 cursor-pointer mt-2 flex items-center justify-center gap-2"
                  >
                    {purchasing === selectedPackage.id || paymentProcessing ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        {isWalletOnly ? (
                          <>
                            <Wallet className="w-4 h-4" />
                            {`Pay ₹${selectedPackage.price} from Wallet`}
                          </>
                        ) : showPayAmount ? (
                          <>
                            <CreditCard className="w-4 h-4" />
                            {wd > 0 ? `Pay ₹${remaining} (₹${wd} from wallet)` : `Pay ₹${selectedPackage.price}`}
                          </>
                        ) : (
                          `Purchase for ₹${selectedPackage.price}`
                        )}
                      </>
                    )}
                  </button>
                );
              })()}
            </div>
          </div>
        </div>
      )}
      <ContactFooter />
    </div>
  );
}
// ─── Package Section (Leather or Tennis) ────────────────
function PackageSection({
  title, dotColor, count, packages, showBallType, purchasing, onPurchase, onSelect, getTimingLabel,
}: {
  title: string;
  dotColor: string;
  count: number;
  packages: PackageInfo[];
  showBallType: boolean;
  purchasing: string | null;
  onPurchase: (id: string) => void;
  onSelect: (pkg: PackageInfo) => void;
  getTimingLabel: (t: string) => string;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className={`w-2 h-2 rounded-full ${dotColor}`}></span>
        <h3 className="text-sm font-bold text-white">{title}</h3>
        <span className="text-[10px] text-slate-500 bg-white/[0.04] px-2 py-0.5 rounded-full">{count}</span>
      </div>
      <div className="space-y-2">
        {packages.map((pkg) => (
          <div
            key={pkg.id}
            className="bg-white/[0.04] backdrop-blur-sm rounded-xl border border-white/[0.08] hover:border-white/[0.12] transition-colors"
          >
            {/* Mobile card layout */}
            <div className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1 cursor-pointer" onClick={() => onSelect(pkg)}>
                  <h4 className="text-sm font-semibold text-white hover:text-accent transition-colors leading-tight">{pkg.name}</h4>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
                    {pkg.machineId && (
                      <span className="text-[10px] text-slate-400 flex items-center gap-1">
                        <Package className="w-3 h-3 text-slate-500" />
                        {labelMap[pkg.machineId] || pkg.machineId}
                      </span>
                    )}
                    {showBallType && pkg.ballType && (
                      <span className="text-[10px] text-slate-400 flex items-center gap-1">
                        <Zap className="w-3 h-3 text-slate-500" />
                        {labelMap[pkg.ballType] || pkg.ballType}
                      </span>
                    )}
                    <span className="text-[10px] text-slate-400 flex items-center gap-1">
                      {pkg.timingType === 'DAY' ? <Sun className="w-3 h-3 text-slate-500" /> : pkg.timingType === 'EVENING' ? <Moon className="w-3 h-3 text-slate-500" /> : <Clock className="w-3 h-3 text-slate-500" />}
                      {getTimingLabel(pkg.timingType)}
                    </span>
                    <span className="text-[10px] text-slate-400 flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-slate-500" />
                      {pkg.totalSessions} Sessions (Per Slot: 30 Minutes) · {pkg.validityDays} Days Validity
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-sm font-bold text-accent">₹{pkg.price}</span>
                  <button
                    onClick={() => onSelect(pkg)}
                    disabled={purchasing === pkg.id}
                    className="bg-accent hover:bg-accent-light text-primary px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {purchasing === pkg.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Buy'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Detail Item for Modal ──────────────────────────────
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
