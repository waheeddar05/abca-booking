'use client';

import { useState, useEffect, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import {
  Package,
  Loader2,
  ShoppingCart,
  Clock,
  X,
  RotateCcw,
  Sun,
  Moon,
  Zap,
  Calendar,
  CreditCard,
  Settings2,
  LayoutGrid,
  Users,
  UserCog,
} from 'lucide-react';
import Link from 'next/link';
import { differenceInDays, startOfDay, format } from 'date-fns';
import { useRazorpay, usePaymentConfig } from '@/lib/useRazorpay';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { LABEL_MAP } from '@/lib/client-constants';
import { ContactFooter } from '@/components/ContactFooter';
import { PackageFirstBookingBanner } from '@/components/ui/PackageFirstBookingBanner';
import { useCenter } from '@/lib/center-context';
import {
  PACKAGE_CATEGORY_LABEL,
  PACKAGE_TIMING_LABEL,
  PACKAGE_WICKET_LABEL,
  packageCategoryLabel,
  categoryUsesBallType,
} from '@/lib/package-admin-labels';

import { Wallet } from 'lucide-react';

/**
 * BookingCategory ids supported by the user-side packages page. Mirrors
 * the canonical list used in `pitch-config.ts` and the admin
 * `EnabledCategoriesEditor`. Legacy ABCA packages without an explicit
 * category are treated as `MACHINE` for filtering / display.
 */
type BookingCategory = 'MACHINE' | 'NET' | 'SIDEARM' | 'COACHING' | 'FULL_COURT';

/** Compact center-machine row used to power the Bowling Machine
 *  sub-filter. Fetched from the public `/api/centers/[id]/machines`
 *  endpoint — same source the user-facing slot picker uses, so the chips
 *  here are guaranteed to match what the user sees at booking time. */
interface CenterMachine {
  id: string;
  name: string;
  shortName?: string | null;
  /** Bridge to the legacy MachineId enum for ABCA-style packages where
   *  `Package.machineId` is the enum string (e.g. `YANTRA`). Null on
   *  newly-added machines at resource-based centers. */
  legacyMachineId?: string | null;
  isActive: boolean;
}

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
  // Resource-based (Toplay) axes. Null on legacy ABCA packages — those
  // continue to render via machineId / machineType.
  category?: BookingCategory | null;
  machineRowId?: string | null;
  machineRow?: {
    id: string;
    name: string;
    shortName?: string | null;
    machineType?: { code: string; name: string };
  } | null;
}

interface MyPackage {
  id: string;
  packageName: string;
  machineType: string;
  machineId?: string | null;
  ballType: string;
  wicketType: string;
  pitchTypes?: string[];
  /** Resource-based (Toplay) targeting. Null on ABCA-style packages. */
  category?: BookingCategory | string | null;
  machineRowId?: string | null;
  machineRowName?: string | null;
  timingType: string;
  totalSessions: number;
  usedSessions: number;
  remainingSessions: number;
  activationDate: string | null;
  expiryDate: string | null;
  pendingActivation?: boolean;
  status: string;
  amountPaid: number;
  totalExtraPayments: number;
  bookingHistory: Array<{
    id: string;
    sessionsUsed: number;
    extraCharge: number;
    booking: { date: string; startTime: string; endTime: string; status: string } | null;
  }>;
}

const labelMap = LABEL_MAP;

/** Canonical category cards. Rendered as the top-level browse filter on
 *  the packages page. The actual list shown is the intersection with the
 *  center's `ENABLED_BOOKING_CATEGORIES` policy, so a center that only
 *  offers Bowling Machine + Cricket Nets shows just those two cards. */
const CATEGORY_CARDS: Array<{
  id: BookingCategory;
  label: string;
  sub: string;
  icon: typeof Settings2;
  dot: string;
}> = [
  { id: 'MACHINE',    label: 'Bowling Machine',  sub: 'Yantra / Leverage',          icon: Settings2,  dot: 'bg-red-500' },
  { id: 'NET',        label: 'Cricket Nets',     sub: 'Bare net for self practice', icon: LayoutGrid, dot: 'bg-cyan-500' },
  { id: 'SIDEARM',    label: 'Sidearm',          sub: 'Bowled by a specialist',     icon: Users,      dot: 'bg-emerald-500' },
  { id: 'FULL_COURT', label: 'Full Indoor Court',sub: 'Entire indoor court',        icon: LayoutGrid, dot: 'bg-purple-500' },
  { id: 'COACHING',   label: 'Personal Coaching',sub: 'With a coach',               icon: UserCog,    dot: 'bg-amber-500' },
];

/**
 * Normalise a package row to a BookingCategory. Legacy ABCA packages
 * predate the `category` column on Package — every such row is a
 * bowling-machine package, so we treat null as `MACHINE`.
 */
function packageCategory(pkg: { category?: string | null }): BookingCategory {
  const c = pkg.category;
  if (c === 'NET' || c === 'SIDEARM' || c === 'COACHING' || c === 'FULL_COURT') return c;
  return 'MACHINE';
}

export default function PackagesPage() {
  const { data: session } = useSession();
  const [tab, setTab] = useState<'browse' | 'my'>('my');
  const [packages, setPackages] = useState<PackageInfo[]>([]);
  const [enabledCategories, setEnabledCategories] = useState<BookingCategory[] | null>(null);
  const [myPackages, setMyPackages] = useState<MyPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [message, setMessage] = useState({ text: '', type: '' });
  /** Top-level category filter. `null` (no selection) shows all
   *  packages — matches the admin Packages tab which lists everything
   *  by default after commit bec7435. */
  const [categoryFilter, setCategoryFilter] = useState<BookingCategory | null>(null);
  /** Secondary timing chip. `null` means "no timing filter" so packages
   *  of any timing (Day, Evening, Both) are shown. */
  const [timingFilter, setTimingFilter] = useState<'DAY' | 'EVENING' | null>(null);
  /** Machine sub-filter — only relevant when `categoryFilter === MACHINE`.
   *  Stores the Machine row id; matches packages by either `machineRowId`
   *  (resource centers) or by the corresponding `legacyMachineId` (ABCA
   *  packages where `Package.machineId` is the enum string). `null` =
   *  "All machines". */
  const [machineFilter, setMachineFilter] = useState<string | null>(null);
  const [centerMachines, setCenterMachines] = useState<CenterMachine[]>([]);
  const { currentCenter } = useCenter();
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
      if (res.ok) {
        // Newer envelope is `{ packages, enabledCategories, bookingModel }`.
        // Fall back to the legacy bare-array shape if an older deploy is
        // serving this client.
        const data = await res.json();
        if (Array.isArray(data)) {
          setPackages(data);
          setEnabledCategories(null);
        } else {
          setPackages(Array.isArray(data?.packages) ? data.packages : []);
          setEnabledCategories(
            Array.isArray(data?.enabledCategories) ? data.enabledCategories : null,
          );
        }
      }
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

  // Fetch the center's active machines once (and on center switch). Used
  // to power the Bowling Machine sub-filter chip row. Same public endpoint
  // the resource-based slot picker uses, so the chips line up with what
  // the user actually sees when booking.
  useEffect(() => {
    if (!currentCenter) {
      setCenterMachines([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/centers/${currentCenter.id}/machines`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: CenterMachine[]) => {
        if (cancelled) return;
        setCenterMachines(Array.isArray(rows) ? rows.filter((m) => m.isActive) : []);
      })
      .catch(() => {
        if (!cancelled) setCenterMachines([]);
      });
    return () => {
      cancelled = true;
    };
  }, [currentCenter]);

  // Clear the machine sub-filter whenever the user moves away from the
  // Bowling Machine category — otherwise selecting Nets/Sidearm would
  // silently keep a stale machine constraint that the user can't see.
  useEffect(() => {
    if (categoryFilter !== 'MACHINE' && machineFilter !== null) {
      setMachineFilter(null);
    }
  }, [categoryFilter, machineFilter]);

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

  const hasActiveFilter =
    categoryFilter !== null || timingFilter !== null || machineFilter !== null;

  const clearFilters = () => {
    setCategoryFilter(null);
    setTimingFilter(null);
    setMachineFilter(null);
  };

  /** Visible category cards = canonical list ∩ center's enabled
   *  categories. We always show MACHINE for legacy ABCA installs where
   *  the policy hasn't been initialised, because every ABCA package is
   *  effectively MACHINE-category. */
  const visibleCategoryCards = useMemo(() => {
    if (!enabledCategories || enabledCategories.length === 0) {
      // Either pre-policy or the API returned the legacy array shape.
      // Fall back to the categories actually represented in the
      // package list — that way ABCA still shows just "Bowling Machine"
      // while a multi-category center shows everything it really has.
      const present = new Set<BookingCategory>(packages.map(packageCategory));
      return CATEGORY_CARDS.filter((c) => present.has(c.id));
    }
    const enabledSet = new Set(enabledCategories);
    return CATEGORY_CARDS.filter((c) => enabledSet.has(c.id));
  }, [enabledCategories, packages]);

  // Filter the package list by the active category + timing + machine
  // chips. Machine filter is only meaningful when the active category is
  // MACHINE (the UI hides the chip row otherwise and clears the value).
  const filteredPackages = useMemo(() => {
    let filtered = packages;
    if (categoryFilter) {
      filtered = filtered.filter((p) => packageCategory(p) === categoryFilter);
    }
    if (timingFilter) {
      filtered = filtered.filter((p) => p.timingType === timingFilter || p.timingType === 'BOTH');
    }
    if (categoryFilter === 'MACHINE' && machineFilter) {
      const m = centerMachines.find((cm) => cm.id === machineFilter);
      const legacy = m?.legacyMachineId ?? null;
      filtered = filtered.filter((p) => {
        // Resource-based packages pin a specific Machine row.
        if (p.machineRowId && p.machineRowId === machineFilter) return true;
        // Legacy ABCA packages reference the MachineId enum on
        // `Package.machineId`. Bridge through the selected machine's
        // `legacyMachineId` to keep both shapes filterable from the same
        // chip row.
        if (legacy && p.machineId === legacy) return true;
        return false;
      });
    }
    return filtered;
  }, [packages, categoryFilter, timingFilter, machineFilter, centerMachines]);

  const getTimingLabel = (t: string) => PACKAGE_TIMING_LABEL[t] || t;

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
                {myPackages.map(up => (
                  <PurchasedPackageCard key={up.id} pkg={up} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* BROWSE PACKAGES TAB */}
        {tab === 'browse' && (
          <div>
            {/* ─── Filters Section ─── */}
            <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] p-4 mb-5">
              {/* Booking Category Filter */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Booking Category
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
                {visibleCategoryCards.length === 0 ? (
                  <p className="text-[11px] text-slate-500 italic">
                    No booking categories enabled for {currentCenter?.name || 'this center'}.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {visibleCategoryCards.map((card) => {
                      const isSelected = categoryFilter === card.id;
                      const Icon = card.icon;
                      return (
                        <button
                          key={card.id}
                          onClick={() => {
                            // Toggle: clicking the active card clears
                            // the category lens. Timing is preserved so
                            // a user can flip between categories while
                            // keeping their Day/Evening preference.
                            setCategoryFilter(isSelected ? null : card.id);
                          }}
                          className={`flex items-center gap-2 px-2.5 py-2 rounded-lg transition-all cursor-pointer text-left ${
                            isSelected
                              ? 'bg-accent/15 ring-1 ring-accent/50 shadow-sm'
                              : 'bg-white/[0.04] border border-white/[0.08] hover:border-accent/30'
                          }`}
                        >
                          <div className={`w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 ${
                            isSelected ? 'bg-accent/20' : 'bg-white/[0.06]'
                          }`}>
                            <Icon className={`w-3.5 h-3.5 ${isSelected ? 'text-accent' : 'text-slate-400'}`} />
                          </div>
                          <div className="min-w-0">
                            <span className={`text-[11px] font-bold leading-tight block ${isSelected ? 'text-accent' : 'text-slate-300'}`}>
                              {card.label}
                            </span>
                            <p className={`text-[9px] truncate ${isSelected ? 'text-accent/70' : 'text-slate-500'}`}>
                              {card.sub}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Machine sub-filter — only meaningful when the user has
                  picked the Bowling Machine category. Single-select with
                  an "All machines" reset. Chips match the resource-based
                  slot picker (same data source) so the user sees the
                  exact machine names they'd encounter at booking time.
                  Hidden when the center has no machines configured. */}
              {categoryFilter === 'MACHINE' && centerMachines.length > 0 && (
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      Machine
                    </label>
                    {machineFilter && (
                      <button
                        onClick={() => setMachineFilter(null)}
                        className="inline-flex items-center gap-1 text-[10px] text-slate-500 hover:text-accent transition-colors cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                        Clear
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      onClick={() => setMachineFilter(null)}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all cursor-pointer ${
                        machineFilter === null
                          ? 'bg-accent/15 text-accent ring-1 ring-accent/50'
                          : 'bg-white/[0.04] text-slate-300 border border-white/[0.08] hover:border-accent/30'
                      }`}
                    >
                      All machines
                    </button>
                    {centerMachines.map((m) => {
                      const isActive = machineFilter === m.id;
                      const label = m.shortName ?? m.name;
                      return (
                        <button
                          key={m.id}
                          onClick={() => setMachineFilter(isActive ? null : m.id)}
                          className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all cursor-pointer ${
                            isActive
                              ? 'bg-accent/15 text-accent ring-1 ring-accent/50'
                              : 'bg-white/[0.04] text-slate-300 border border-white/[0.08] hover:border-accent/30'
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Timing Filter — secondary chip, single-select with
                  clear. Defaults to no selection so packages of any
                  timing (Day, Evening, Both) show through. */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Timing
                  </label>
                  {timingFilter && (
                    <button
                      onClick={() => setTimingFilter(null)}
                      className="inline-flex items-center gap-1 text-[10px] text-slate-500 hover:text-accent transition-colors cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                      Clear
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { key: 'DAY' as const,     label: 'Day',     sub: '7:00 AM – 5:00 PM',  Icon: Sun },
                    { key: 'EVENING' as const, label: 'Evening', sub: '7:00 PM – 10:30 PM', Icon: Moon },
                  ]).map(t => {
                    const isActive = timingFilter === t.key;
                    return (
                      <button
                        key={t.key}
                        onClick={() => setTimingFilter(isActive ? null : t.key)}
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
                          <span className={`text-[9px] ${isActive ? 'text-accent/70' : 'text-slate-500'}`}>
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
              <div className="space-y-2">
                {/* Single uniform card list — matches the admin
                    Available Packages cards (AdminPackageCard) from
                    commit bec7435 so admins and users see the same
                    package treatment. */}
                {filteredPackages.map((pkg) => (
                  <PackageCard
                    key={pkg.id}
                    pkg={pkg}
                    purchasing={purchasing}
                    onSelect={setSelectedPackage}
                    getTimingLabel={getTimingLabel}
                  />
                ))}
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
                <span className="inline-block mt-1 text-[10px] px-2 py-0.5 rounded-full font-semibold bg-purple-500/15 text-purple-300">
                  {packageCategoryLabel(selectedPackage.category)}
                  {selectedPackage.machineRow ? ` · ${selectedPackage.machineRow.shortName ?? selectedPackage.machineRow.name}` : ''}
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
                <DetailItem
                  label="Category"
                  value={packageCategoryLabel(selectedPackage.category)}
                />
                {/* Machine — show pinned Machine row first (resource
                    centers), then ABCA's legacy enum machine. Only
                    relevant for MACHINE-category packages, which we
                    enforce via packageCategory() so non-machine
                    packages don't leak a machine chip. */}
                {packageCategory(selectedPackage) === 'MACHINE' && selectedPackage.machineRow && (
                  <DetailItem
                    label="Machine"
                    value={selectedPackage.machineRow.shortName ?? selectedPackage.machineRow.name}
                  />
                )}
                {packageCategory(selectedPackage) === 'MACHINE' && !selectedPackage.machineRow && selectedPackage.machineId && (
                  <DetailItem
                    label="Machine"
                    value={labelMap[selectedPackage.machineId] || selectedPackage.machineId}
                  />
                )}
                {categoryUsesBallType(selectedPackage.category) && selectedPackage.ballType && (
                  <DetailItem
                    label="Ball Type"
                    value={labelMap[selectedPackage.ballType] || selectedPackage.ballType}
                  />
                )}
                {selectedPackage.wicketType && (
                  <DetailItem
                    label="Pitch"
                    value={PACKAGE_WICKET_LABEL[selectedPackage.wicketType] || selectedPackage.wicketType}
                  />
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

// ─── Package Card (Browse list) ─────────────────────────
/**
 * Single uniform package card used in the Browse tab. Visual structure
 * mirrors the admin AdminPackageCard from commit bec7435: name +
 * category chip + price on the top row, chip row of axes (machine /
 * ball / pitch / timing / sessions) below, click anywhere on the card
 * to open the detail modal.
 */
function PackageCard({
  pkg, purchasing, onSelect, getTimingLabel,
}: {
  pkg: PackageInfo;
  purchasing: string | null;
  onSelect: (pkg: PackageInfo) => void;
  getTimingLabel: (t: string) => string;
}) {
  const cat = packageCategory(pkg);
  const showBallType = cat === 'MACHINE' && pkg.machineType !== 'TENNIS' && !!pkg.ballType;
  const machineLabel = pkg.machineRow
    ? (pkg.machineRow.shortName ?? pkg.machineRow.name)
    : (pkg.machineId ? (labelMap[pkg.machineId] || pkg.machineId) : null);

  return (
    <div className="bg-white/[0.04] backdrop-blur-sm rounded-xl border border-white/[0.08] hover:border-white/[0.12] transition-colors">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div
            className="min-w-0 flex-1 cursor-pointer"
            onClick={() => onSelect(pkg)}
          >
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-sm font-semibold text-white hover:text-accent transition-colors leading-tight">{pkg.name}</h4>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-purple-500/15 text-purple-300">
                {PACKAGE_CATEGORY_LABEL[cat]}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
              {cat === 'MACHINE' && machineLabel && (
                <span className="text-[10px] text-slate-400 flex items-center gap-1">
                  <Package className="w-3 h-3 text-slate-500" />
                  {machineLabel}
                </span>
              )}
              {showBallType && (
                <span className="text-[10px] text-slate-400 flex items-center gap-1">
                  <Zap className="w-3 h-3 text-slate-500" />
                  {labelMap[pkg.ballType] || pkg.ballType}
                </span>
              )}
              {pkg.wicketType && (
                <span className="text-[10px] text-slate-400 flex items-center gap-1">
                  <span className="text-slate-500">Pitch:</span>
                  <span className="text-slate-300">{PACKAGE_WICKET_LABEL[pkg.wicketType] || pkg.wicketType}</span>
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
  );
}

// ─── Purchased Package Card (My Packages) ────────────────
/**
 * Compact card for a row in the "My Packages" list. Every load-bearing
 * field — Sessions Left, Total, Used, Expiry date and days remaining —
 * is rendered inline; nothing is hidden behind a click. Vertical
 * footprint is roughly half the previous (large callouts + "View
 * details" expander) layout while preserving the same information
 * density via a single compact stats row.
 */
function PurchasedPackageCard({ pkg }: { pkg: MyPackage }) {
  const remaining = pkg.totalSessions - pkg.usedSessions;
  const isActive = pkg.status === 'ACTIVE';
  const isExpired = pkg.status === 'EXPIRED';

  const today = startOfDay(new Date());
  const expiryDateObj = pkg.expiryDate ? startOfDay(new Date(pkg.expiryDate)) : null;
  const daysRemaining = expiryDateObj ? differenceInDays(expiryDateObj, today) : null;
  const isFirstBookingPending = isActive && pkg.usedSessions === 0;

  const cat = packageCategory(pkg);
  const showBallType = cat === 'MACHINE' && pkg.machineType !== 'TENNIS' && !!pkg.ballType;
  const pitches = (pkg.pitchTypes && pkg.pitchTypes.length > 0)
    ? pkg.pitchTypes
    : (pkg.wicketType ? [pkg.wicketType] : []);
  const machineLabel = pkg.machineRowName
    ?? (pkg.machineId ? (labelMap[pkg.machineId] || pkg.machineId) : null);

  const purchaseFmt = pkg.activationDate
    ? format(new Date(pkg.activationDate), 'dd MMM yyyy')
    : null;
  const expiryFmt = pkg.expiryDate
    ? format(new Date(pkg.expiryDate), 'dd MMM yyyy')
    : null;

  // Sessions-Left colour escalates from green (lots left) → amber
  // (running low) → red (last session). Keeps the most actionable
  // number visually prominent inline.
  const sessionsLeftColor =
    remaining <= 1 ? 'text-red-400'
    : remaining <= 3 ? 'text-amber-400'
    : 'text-emerald-400';

  // Validity-days colour — red ≤ 3 days (and overdue), amber ≤ 7 days,
  // neutral otherwise. Matches the spec exactly.
  const daysColor =
    daysRemaining === null ? 'text-slate-300'
    : daysRemaining < 0 ? 'text-red-400'
    : daysRemaining <= 3 ? 'text-red-400'
    : daysRemaining <= 7 ? 'text-amber-400'
    : 'text-slate-300';

  // Inline "days left" suffix shown right next to the expiry date so the
  // user sees urgency without scanning a second line.
  const daysLeftSuffix = (() => {
    if (pkg.pendingActivation) return 'Starts on first booking';
    if (daysRemaining === null) return null;
    if (isExpired) return 'Expired';
    if (daysRemaining < 0) {
      const n = Math.abs(daysRemaining);
      return `${n} day${n === 1 ? '' : 's'} overdue`;
    }
    if (daysRemaining === 0) return 'Expires today';
    return `${daysRemaining} day${daysRemaining === 1 ? '' : 's'} left`;
  })();

  return (
    <div>
      {isFirstBookingPending && (
        <PackageFirstBookingBanner packageName={pkg.packageName} />
      )}
      <div className="bg-white/[0.04] backdrop-blur-sm rounded-xl border border-white/[0.08] p-3.5">
        {/* Header: name, status, category chip, Book CTA */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold text-white leading-tight">{pkg.packageName}</h3>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                isActive ? 'bg-green-500/15 text-green-400' :
                isExpired ? 'bg-red-500/15 text-red-400' :
                'bg-slate-500/15 text-slate-400'
              }`}>
                {pkg.status}
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-purple-500/15 text-purple-300">
                {PACKAGE_CATEGORY_LABEL[cat]}
              </span>
            </div>
          </div>
          {isActive && remaining > 0 && (
            <Link
              href="/slots"
              className="bg-accent hover:bg-accent-light text-primary px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors flex-shrink-0"
            >
              Book
            </Link>
          )}
        </div>

        {/* Chip row — category-derived axes (machine, ball, pitch),
            timing, and purchase date. Mirrors the AdminPackageCard
            chip strip so admin and user views line up visually. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
          {cat === 'MACHINE' && machineLabel && (
            <span className="text-[10px] text-slate-400 flex items-center gap-1">
              <Package className="w-3 h-3 text-slate-500" />
              {machineLabel}
            </span>
          )}
          {showBallType && (
            <span className="text-[10px] text-slate-400 flex items-center gap-1">
              <Zap className="w-3 h-3 text-slate-500" />
              {labelMap[pkg.ballType] || pkg.ballType}
            </span>
          )}
          {pitches.length > 0 && (
            <span className="text-[10px] text-slate-400 flex items-center gap-1">
              <span className="text-slate-500">Pitch:</span>
              <span className="text-slate-300">{pitches.map(p => PACKAGE_WICKET_LABEL[p] || labelMap[p] || p).join(', ')}</span>
            </span>
          )}
          <span className="text-[10px] text-slate-400 flex items-center gap-1">
            {pkg.timingType === 'DAY' ? <Sun className="w-3 h-3 text-slate-500" /> : pkg.timingType === 'EVENING' ? <Moon className="w-3 h-3 text-slate-500" /> : <Clock className="w-3 h-3 text-slate-500" />}
            {PACKAGE_TIMING_LABEL[pkg.timingType] || pkg.timingType}
          </span>
          {purchaseFmt && (
            <span className="text-[10px] text-slate-400 flex items-center gap-1">
              <Calendar className="w-3 h-3 text-slate-500" />
              Purchased {purchaseFmt}
            </span>
          )}
        </div>

        {/* Single compact stats row — Sessions Left + Expiry inline.
            Small labels, bold numbers, no large callout blocks. Wraps
            cleanly on narrow screens by splitting the two halves onto
            separate lines via flex-wrap. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2.5 pt-2.5 border-t border-white/[0.05]">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[10px] text-slate-500">Sessions Left:</span>
            <span className={`text-sm font-bold ${sessionsLeftColor}`}>{remaining}</span>
            <span className="text-[10px] text-slate-500">
              · Total: {pkg.totalSessions} · Used: {pkg.usedSessions}
            </span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-[10px] text-slate-500">Expires:</span>
            <span className={`text-[11px] font-semibold ${daysColor}`}>
              {pkg.pendingActivation
                ? 'Pending'
                : expiryFmt ?? 'No expiry'}
            </span>
            {daysLeftSuffix && (
              <span className={`text-[10px] ${daysColor}`}>
                ({daysLeftSuffix})
              </span>
            )}
          </div>
        </div>
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
