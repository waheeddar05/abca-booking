'use client';

/**
 * Unified staff dashboard.
 *
 * Replaces the legacy /operator page, which only showed bookings on
 * machines this user was assigned to as an OPERATOR. Now a single
 * user can hold any combination of OPERATOR / COACH / SIDEARM_SPECIALIST
 * memberships at a center, and this page surfaces a tab for each role
 * the user actually has (admins see all three). Switching tabs filters
 * the booking list by the booking *category* that role handles — every
 * such booking at the center, regardless of which staff member is
 * assigned:
 *
 *   - Operator → MACHINE  bookings (bowling-machine sessions)
 *   - Coach    → COACHING bookings (personal-coaching sessions)
 *   - Sidearm  → SIDEARM  bookings (sidearm-specialist sessions)
 */

import { useEffect, useState, useCallback } from 'react';
import {
  ClipboardList, Loader2, Calendar,
  ChevronLeft, ChevronRight, ChevronDown,
  Filter, Search, ArrowUpDown, Wrench, UserCog, Users,
} from 'lucide-react';
import { BookingCard } from '@/components/BookingCard';

type StaffRole = 'OPERATOR' | 'COACH' | 'SIDEARM_SPECIALIST';

interface Booking {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  status: 'BOOKED' | 'CANCELLED' | 'DONE';
  category: string | null;
  playerName: string;
  ballType: string;
  pitchType: string | null;
  machineId: string | null;
  assignedMachineId: string | null;
  assignedMachineName: string | null;
  assignedCoachName: string | null;
  assignedStaffName: string | null;
  price: number | null;
  originalPrice: number | null;
  discountAmount: number | null;
  extraCharge: number | null;
  operationMode: 'WITH_OPERATOR' | 'SELF_OPERATE';
  kitRental: boolean;
  kitRentalCharge: number | null;
  cancelledBy: string | null;
  createdAt: string | null;
  paymentMethod: string | null;
  paymentStatus: string | null;
  isPackageBooking: boolean;
  packageName: string | null;
  operatorName: string | null;
  operatorMobile: string | null;
  customerName: string;
  customerEmail: string | null;
  customerMobile: string | null;
}

type Category = 'all' | 'today' | 'upcoming' | 'previous' | 'lastMonth';

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface StaffMeResponse {
  userId: string;
  userName: string | null;
  centerId: string;
  centerName: string;
  isAdmin: boolean;
  roles: StaffRole[];
}

/**
 * Compact center-machine row used to populate the Machine filter dropdown
 * on the operator tab. Fetched from the public `/api/centers/[id]/machines`
 * endpoint so the options always reflect what admins have configured at
 * the current center (and not the hardcoded ABCA-era `MACHINES` constant).
 *
 * `legacyMachineId` bridges to the legacy `MachineId` enum used by ABCA
 * bookings; resource-based machines (e.g. Toplay Master 200) have it null
 * and are filtered via `Machine.id` against `Booking.assignedMachineId`.
 */
interface CenterMachine {
  id: string;
  name: string;
  shortName?: string | null;
  legacyMachineId?: string | null;
  isActive: boolean;
}

const CATEGORY_TABS = [
  { key: 'all', label: 'All' },
  { key: 'today', label: 'Today' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'previous', label: 'Previous' },
  { key: 'lastMonth', label: 'Last Month' },
] as const;

const ROLE_LABELS: Record<StaffRole, { label: string; sub: string; icon: typeof Wrench }> = {
  OPERATOR: { label: 'Operator', sub: 'Bowling machine sessions', icon: Wrench },
  COACH: { label: 'Coach', sub: 'Personal coaching sessions', icon: UserCog },
  SIDEARM_SPECIALIST: { label: 'Sidearm', sub: 'Sidearm specialist sessions', icon: Users },
};

export default function StaffDashboard() {
  const [me, setMe] = useState<StaffMeResponse | null>(null);
  const [meLoading, setMeLoading] = useState(true);
  const [meError, setMeError] = useState<string | null>(null);

  const [role, setRole] = useState<StaffRole | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [category, setCategory] = useState<Category>('all');
  const [pagination, setPagination] = useState<PaginationInfo>({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [showFilters, setShowFilters] = useState(false);
  const [showDateRange, setShowDateRange] = useState(false);
  const [sortBy, setSortBy] = useState('date');
  const [sortOrder, setSortOrder] = useState('desc');
  const [filters, setFilters] = useState({
    status: '',
    customer: '',
    date: '',
    from: '',
    to: '',
    machineId: '',
  });
  // Center's configured machines — populates the Machine filter on the
  // operator tab. Loaded lazily once we know the current center id (from
  // /api/staff/me). Empty list while loading or if the center has no
  // active machines.
  const [centerMachines, setCenterMachines] = useState<CenterMachine[]>([]);

  // Bootstrap — what roles does the user have?
  useEffect(() => {
    setMeLoading(true);
    fetch('/api/staff/me')
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          throw new Error(data?.error || `Status ${r.status}`);
        }
        return r.json();
      })
      .then((data: StaffMeResponse) => {
        setMe(data);
        if (data.roles.length > 0) {
          setRole(data.roles[0]);
        }
      })
      .catch((err: Error) => {
        setMeError(err.message);
      })
      .finally(() => setMeLoading(false));
  }, []);

  // Pull the active machines for the resolved center. Powers the operator
  // tab's Machine filter dropdown so it shows only the machines actually
  // configured at this center — not the hardcoded ABCA-era list. Re-runs
  // whenever the center changes (admin centre-switch → new options).
  useEffect(() => {
    if (!me?.centerId) {
      setCenterMachines([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/centers/${me.centerId}/machines`)
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
  }, [me?.centerId]);

  const fetchBookings = useCallback(async () => {
    if (!role) return;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('role', role);
      if (category !== 'all') params.set('category', category);
      if (filters.status) params.set('status', filters.status);
      if (filters.customer) params.set('customer', filters.customer);
      if (filters.date) params.set('filterDate', filters.date);
      if (filters.from && filters.to) {
        params.set('from', filters.from);
        params.set('to', filters.to);
      }
      if (filters.machineId) params.set('machineId', filters.machineId);
      params.set('page', String(pagination.page));
      params.set('limit', '20');
      params.set('sortBy', sortBy);
      params.set('sortOrder', sortOrder);
      const res = await fetch(`/api/staff/bookings?${params.toString()}`);
      if (!res.ok) {
        if (res.status === 403) {
          throw new Error("Access denied. You don't have this role at the current center.");
        }
        const err = await res.json();
        throw new Error(err.error || 'Failed to fetch bookings');
      }
      const data = await res.json();
      setBookings(data.bookings);
      setPagination(data.pagination);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, [role, category, filters, pagination.page, sortBy, sortOrder]);

  // Reset paging + filters when the role tab changes — different
  // role, different bookings universe, so persisting the page index
  // would be confusing.
  useEffect(() => {
    setPagination((prev) => ({ ...prev, page: 1 }));
    setFilters({ status: '', customer: '', date: '', from: '', to: '', machineId: '' });
    setCategory('all');
  }, [role]);

  useEffect(() => {
    if (role) fetchBookings();
  }, [fetchBookings, role]);

  const handleCategoryChange = (newCategory: Category) => {
    setCategory(newCategory);
    setPagination((prev) => ({ ...prev, page: 1 }));
    setFilters((prev) => ({ ...prev, date: '', from: '', to: '' }));
    setShowDateRange(false);
  };

  const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFilters((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    setPagination((prev) => ({ ...prev, page: 1 }));
  };

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
    setPagination((prev) => ({ ...prev, page: 1 }));
  };

  if (meLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin mb-2" />
        <span className="text-sm">Loading…</span>
      </div>
    );
  }

  if (meError || !me) {
    return (
      <div className="text-center py-20">
        <p className="text-red-400 text-sm">{meError ?? 'Unable to load staff context'}</p>
      </div>
    );
  }

  if (me.roles.length === 0) {
    return (
      <div className="max-w-xl mx-auto py-12">
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.04] p-6 text-center">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 mx-auto mb-3 flex items-center justify-center">
            <ClipboardList className="w-5 h-5 text-amber-400" />
          </div>
          <h2 className="text-base font-bold text-white mb-2">No staff role at {me.centerName}</h2>
          <p className="text-xs text-slate-400 leading-relaxed">
            You aren&apos;t assigned as an operator, coach, or sidearm specialist at this center.
            Ask your center admin to add a role on the Centers → Members tab.
          </p>
        </div>
      </div>
    );
  }

  const roleConfig = role ? ROLE_LABELS[role] : null;
  const RoleIcon = roleConfig?.icon ?? ClipboardList;

  return (
    <div className="max-w-2xl mx-auto">
      {/* Page Header */}
      <div className="flex items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center flex-shrink-0">
            <RoleIcon className="w-5 h-5 text-accent" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-white truncate">
              {roleConfig?.label ?? 'Staff'} Bookings
            </h1>
            <p className="text-xs text-slate-400 truncate">
              {pagination.total} session{pagination.total !== 1 ? 's' : ''} · {me.centerName}
            </p>
          </div>
        </div>
      </div>

      {/* Role Tabs — only the roles the user has (admins see all 3) */}
      {me.roles.length > 1 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 mb-4">
          {me.roles.map((r) => {
            const cfg = ROLE_LABELS[r];
            const Icon = cfg.icon;
            const active = role === r;
            return (
              <button
                key={r}
                onClick={() => setRole(r)}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                  active
                    ? 'bg-accent/10 border-accent/40 ring-1 ring-accent/30'
                    : 'bg-white/[0.02] border-white/[0.06] hover:border-accent/20 hover:bg-white/[0.04]'
                }`}
              >
                <Icon className={`w-4 h-4 flex-shrink-0 ${active ? 'text-accent' : 'text-slate-400'}`} />
                <div className="min-w-0">
                  <div className={`text-xs font-semibold truncate ${active ? 'text-accent' : 'text-white'}`}>
                    {cfg.label}
                  </div>
                  <div className="text-[10px] text-slate-500 font-medium truncate">{cfg.sub}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Category Tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 mb-3 scrollbar-hide">
        {CATEGORY_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => handleCategoryChange(tab.key)}
            className={`flex-shrink-0 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              category === tab.key
                ? 'bg-accent text-primary'
                : 'bg-white/[0.04] text-slate-400 border border-white/[0.08] hover:bg-white/[0.06]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white/[0.03] backdrop-blur-sm rounded-2xl border border-white/[0.07] p-3 mb-4 hover:border-white/[0.12] transition-colors">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-2 cursor-pointer"
          >
            <Filter className="w-4 h-4 text-accent" />
            <span className="text-xs font-semibold text-white uppercase tracking-wider">Filters</span>
            <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
          </button>
          <button
            onClick={() => setShowDateRange(!showDateRange)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-all ${
              showDateRange
                ? 'bg-accent/15 text-accent border border-accent/30'
                : 'bg-white/[0.06] text-slate-300 border border-white/[0.12] hover:border-accent/30 hover:text-accent'
            }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            {showDateRange ? 'Hide Date Range' : 'Date Range Filter'}
          </button>
        </div>
        {showFilters && (
          <div className="grid grid-cols-2 gap-2 mt-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1.5">Status</label>
              <select
                name="status"
                value={filters.status}
                onChange={handleFilterChange}
                className="w-full bg-white/[0.06] border border-white/[0.15] text-white rounded-lg px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 cursor-pointer"
              >
                <option value="">All</option>
                <option value="BOOKED">Upcoming</option>
                <option value="IN_PROGRESS">In Progress</option>
                <option value="DONE">Completed</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </div>
            {/* Machine filter — only meaningful for the OPERATOR tab.
                Options are sourced from the center's configured Machine
                rows. Value = `legacyMachineId` when present (ABCA, so the
                bookings API matches on the legacy enum) else `Machine.id`
                (resource-based centers — matches `assignedMachineId`). */}
            {role === 'OPERATOR' && (
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1.5">Machine</label>
                <select
                  name="machineId"
                  value={filters.machineId}
                  onChange={handleFilterChange}
                  className="w-full bg-white/[0.06] border border-white/[0.15] text-white rounded-lg px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 cursor-pointer"
                  disabled={centerMachines.length === 0}
                >
                  <option value="">All Machines</option>
                  {centerMachines.map((m) => {
                    const value = m.legacyMachineId ?? m.id;
                    const label = m.shortName ?? m.name;
                    return (
                      <option key={m.id} value={value}>
                        {label}
                      </option>
                    );
                  })}
                </select>
              </div>
            )}
            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1.5">Customer</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  name="customer"
                  placeholder="Search name or email..."
                  value={filters.customer}
                  onChange={handleFilterChange}
                  className="w-full bg-white/[0.06] border border-white/[0.15] text-white placeholder:text-slate-500 rounded-lg pl-9 pr-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent/20"
                />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1.5">Single Date</label>
              <input
                type="date"
                name="date"
                value={filters.date}
                onChange={(e) => {
                  setFilters((prev) => ({ ...prev, date: e.target.value, from: '', to: '' }));
                  setPagination((prev) => ({ ...prev, page: 1 }));
                }}
                className="w-full bg-white/[0.06] border border-white/[0.15] text-white placeholder:text-slate-500 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent/20"
              />
            </div>
          </div>
        )}
        {showDateRange && showFilters && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3 pt-3 border-t border-white/[0.08]">
            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1.5">From Date</label>
              <input
                type="date"
                name="from"
                value={filters.from}
                onChange={(e) => {
                  setFilters((prev) => ({ ...prev, from: e.target.value, date: '' }));
                  setPagination((prev) => ({ ...prev, page: 1 }));
                }}
                className="w-full bg-white/[0.06] border border-white/[0.15] text-white placeholder:text-slate-500 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent/20"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1.5">To Date</label>
              <input
                type="date"
                name="to"
                value={filters.to}
                onChange={(e) => {
                  setFilters((prev) => ({ ...prev, to: e.target.value, date: '' }));
                  setPagination((prev) => ({ ...prev, page: 1 }));
                }}
                className="w-full bg-white/[0.06] border border-white/[0.15] text-white placeholder:text-slate-500 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent/20"
              />
            </div>
          </div>
        )}
      </div>

      {/* Sort Controls */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Sort by:</span>
        <button
          onClick={() => handleSort('date')}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium cursor-pointer ${
            sortBy === 'date' ? 'bg-accent/15 text-accent' : 'text-slate-400 hover:bg-white/[0.06]'
          }`}
        >
          Date
          {sortBy === 'date' && <ArrowUpDown className="w-3 h-3" />}
        </button>
        <button
          onClick={() => handleSort('createdAt')}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium cursor-pointer ${
            sortBy === 'createdAt' ? 'bg-accent/15 text-accent' : 'text-slate-400 hover:bg-white/[0.06]'
          }`}
        >
          Created
          {sortBy === 'createdAt' && <ArrowUpDown className="w-3 h-3" />}
        </button>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin mb-2" />
          <span className="text-sm">Loading bookings...</span>
        </div>
      ) : error ? (
        <div className="text-center py-20">
          <p className="text-red-400 text-sm">{error}</p>
          <button onClick={fetchBookings} className="mt-3 text-sm text-accent font-medium cursor-pointer">
            Try again
          </button>
        </div>
      ) : bookings.length === 0 ? (
        <div className="text-center py-20">
          <div className="w-14 h-14 rounded-2xl bg-white/[0.04] flex items-center justify-center mx-auto mb-4">
            <ClipboardList className="w-6 h-6 text-slate-500" />
          </div>
          <p className="text-sm font-medium text-slate-300 mb-1">No bookings found</p>
          <p className="text-xs text-slate-400">
            {role === 'OPERATOR'
              ? 'No bowling machine bookings found.'
              : role === 'COACH'
                ? 'No coaching sessions found.'
                : 'No sidearm sessions found.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {bookings.map((booking) => (
            <BookingCard key={booking.id} booking={booking} role="operator" />
          ))}
        </div>
      )}

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 pt-3 border-t border-white/[0.06]">
          <span className="text-xs text-slate-400">
            Page {pagination.page} of {pagination.totalPages}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPagination((prev) => ({ ...prev, page: prev.page - 1 }))}
              disabled={pagination.page <= 1}
              className="p-1.5 rounded-lg hover:bg-white/[0.06] transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4 text-slate-400" />
            </button>
            <span className="text-sm text-slate-300 px-2">{pagination.page}</span>
            <button
              onClick={() => setPagination((prev) => ({ ...prev, page: prev.page + 1 }))}
              disabled={pagination.page >= pagination.totalPages}
              className="p-1.5 rounded-lg hover:bg-white/[0.06] transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4 text-slate-400" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
