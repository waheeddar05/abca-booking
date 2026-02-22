'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { format } from 'date-fns';
import { useSearchParams } from 'next/navigation';
import { Search, Filter, XCircle, RotateCcw, Calendar, Loader2, Download, ChevronLeft, ChevronRight, ArrowUpDown, IndianRupee, Copy, Pencil, X, Check, CalendarPlus, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

type Category = 'all' | 'today' | 'upcoming' | 'previous' | 'lastMonth';

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface Summary {
  booked: number;
  done: number;
  cancelled: number;
  total: number;
}

function AdminBookingsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<Category>((searchParams.get('category') as Category) || 'all');
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 50, total: 0, totalPages: 0 });
  const [summary, setSummary] = useState<Summary>({ booked: 0, done: 0, cancelled: 0, total: 0 });
  const [sortBy, setSortBy] = useState('date');
  const [sortOrder, setSortOrder] = useState('desc');
  const [filters, setFilters] = useState({
    status: '',
    customer: '',
    date: '',
    from: '',
    to: '',
  });
  const [showDateRange, setShowDateRange] = useState(false);
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
  const [editPriceValue, setEditPriceValue] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showBookOnBehalf, setShowBookOnBehalf] = useState(false);
  const [behalfSearch, setBehalfSearch] = useState('');
  const [behalfResults, setBehalfResults] = useState<any[]>([]);
  const [behalfLoading, setBehalfLoading] = useState(false);

  const fetchBookings = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (category !== 'all') params.set('category', category);
      if (filters.status) params.set('status', filters.status);
      if (filters.customer) params.set('customer', filters.customer);
      if (filters.date) params.set('date', filters.date);
      if (filters.from && filters.to) {
        params.set('from', filters.from);
        params.set('to', filters.to);
      }
      params.set('page', String(pagination.page));
      params.set('limit', '50');
      params.set('sortBy', sortBy);
      params.set('sortOrder', sortOrder);

      const res = await fetch(`/api/admin/bookings?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setBookings(data.bookings);
        setPagination(data.pagination);
        setSummary(data.summary);
      }
    } catch (error) {
      console.error('Failed to fetch bookings', error);
    } finally {
      setLoading(false);
    }
  }, [category, filters, pagination.page, sortBy, sortOrder]);

  useEffect(() => {
    fetchBookings();
  }, [fetchBookings]);

  useEffect(() => {
    const cat = searchParams.get('category');
    if (cat && cat !== category) {
      setCategory(cat as Category);
    }
  }, [searchParams]);

  const handleCategoryChange = (newCategory: Category) => {
    setCategory(newCategory);
    setPagination(prev => ({ ...prev, page: 1 }));
    setFilters(prev => ({ ...prev, date: '', from: '', to: '' }));
    setShowDateRange(false);
  };

  const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFilters(prev => ({ ...prev, [e.target.name]: e.target.value }));
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const updateStatus = async (bookingId: string, status: string) => {
    if (!confirm(`Are you sure you want to mark this booking as ${status}?`)) return;
    try {
      const res = await fetch('/api/admin/bookings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId, status }),
      });
      if (res.ok) {
        fetchBookings();
      } else {
        const data = await res.json();
        alert(data.error || 'Update failed');
      }
    } catch (error) {
      console.error('Failed to update booking', error);
      alert('Failed to update booking');
    }
  };

  const updatePrice = async (bookingId: string) => {
    const price = parseFloat(editPriceValue);
    if (isNaN(price) || price < 0) {
      alert('Please enter a valid price');
      return;
    }
    setActionLoading(bookingId);
    try {
      const res = await fetch('/api/admin/bookings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId, price }),
      });
      if (res.ok) {
        setEditingPriceId(null);
        setEditPriceValue('');
        fetchBookings();
      } else {
        const data = await res.json();
        alert(data.error || 'Price update failed');
      }
    } catch {
      alert('Failed to update price');
    } finally {
      setActionLoading(null);
    }
  };

  const copyToNextSlot = async (bookingId: string) => {
    if (!confirm('Copy this booking to the next consecutive slot?')) return;
    setActionLoading(bookingId);
    try {
      const res = await fetch('/api/admin/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId, action: 'copy_next_slot' }),
      });
      if (res.ok) {
        alert('Booking copied to next slot successfully');
        fetchBookings();
      } else {
        const data = await res.json();
        alert(data.error || 'Copy failed');
      }
    } catch {
      alert('Failed to copy booking');
    } finally {
      setActionLoading(null);
    }
  };

  const handleExport = () => {
    const params = new URLSearchParams();
    if (category !== 'all') params.set('category', category);
    if (filters.status) params.set('status', filters.status);
    if (filters.date) params.set('date', filters.date);
    if (filters.from && filters.to) {
      params.set('from', filters.from);
      params.set('to', filters.to);
    }
    window.open(`/api/admin/bookings/export?${params.toString()}`, '_blank');
  };

  const searchUsersForBehalf = async (query: string) => {
    if (!query || query.length < 2) {
      setBehalfResults([]);
      return;
    }
    setBehalfLoading(true);
    try {
      const res = await fetch(`/api/admin/users?search=${encodeURIComponent(query)}`);
      if (res.ok) {
        const data = await res.json();
        setBehalfResults(Array.isArray(data) ? data.slice(0, 10) : []);
      }
    } catch {
      setBehalfResults([]);
    } finally {
      setBehalfLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      if (behalfSearch) searchUsersForBehalf(behalfSearch);
    }, 300);
    return () => clearTimeout(timer);
  }, [behalfSearch]);

  const selectUserForBehalf = (user: any) => {
    const name = user.name || user.playerName || user.email || user.mobileNumber || 'User';
    router.push(`/slots?userId=${user.id}&userName=${encodeURIComponent(name)}`);
  };

  const statusConfig: Record<string, { label: string; bg: string; text: string; dot: string }> = {
    BOOKED: { label: 'Booked', bg: 'bg-green-500/10', text: 'text-green-400', dot: 'bg-green-500' },
    DONE: { label: 'Done', bg: 'bg-blue-500/10', text: 'text-blue-400', dot: 'bg-blue-500' },
    CANCELLED: { label: 'Cancelled', bg: 'bg-white/[0.04]', text: 'text-slate-400', dot: 'bg-gray-400' },
  };

  const ballTypeConfig: Record<string, string> = {
    TENNIS: 'bg-green-500',
    LEATHER: 'bg-red-500',
    MACHINE: 'bg-blue-500',
  };

  const tabs: Array<{ key: Category; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'today', label: 'Today' },
    { key: 'upcoming', label: 'Upcoming' },
    { key: 'previous', label: 'Previous' },
    { key: 'lastMonth', label: 'Last Month' },
  ];

  const startEditPrice = (booking: any) => {
    setEditingPriceId(booking.id);
    setEditPriceValue(booking.price != null ? String(booking.price) : '');
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
            <Calendar className="w-5 h-5 text-accent" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-white">Bookings</h1>
            <p className="text-xs text-slate-400">Manage all bookings</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowBookOnBehalf(true)}
            className="inline-flex items-center justify-center gap-2 px-3 py-2 bg-accent text-primary rounded-lg text-xs font-bold hover:bg-accent-light transition-colors cursor-pointer"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Book on</span> Behalf
          </button>
          <button
            onClick={handleExport}
            className="inline-flex items-center justify-center gap-2 px-3 py-2 bg-white/[0.06] text-slate-300 rounded-lg text-xs font-medium hover:bg-white/[0.1] transition-colors cursor-pointer border border-white/[0.08]"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Export</span> CSV
          </button>
        </div>

        {/* Book on Behalf Modal */}
        {showBookOnBehalf && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setShowBookOnBehalf(false)}>
            <div className="bg-[#1a1a2e] rounded-2xl border border-white/[0.1] w-full max-w-md p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <UserPlus className="w-5 h-5 text-accent" />
                  <h3 className="text-sm font-bold text-white">Book on Behalf of User</h3>
                </div>
                <button onClick={() => setShowBookOnBehalf(false)} className="p-1 text-slate-400 hover:text-white transition-colors cursor-pointer">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search by name, email or mobile..."
                  value={behalfSearch}
                  onChange={e => setBehalfSearch(e.target.value)}
                  className="w-full bg-white/[0.06] border border-white/[0.15] text-white placeholder:text-slate-500 rounded-lg pl-9 pr-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent/20"
                  autoFocus
                />
              </div>
              <div className="max-h-64 overflow-y-auto space-y-1">
                {behalfLoading ? (
                  <div className="flex items-center justify-center py-6 text-slate-400">
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    <span className="text-xs">Searching...</span>
                  </div>
                ) : behalfResults.length > 0 ? (
                  behalfResults.map(user => (
                    <button
                      key={user.id}
                      onClick={() => selectUserForBehalf(user)}
                      className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-white/[0.06] transition-colors cursor-pointer"
                    >
                      <div className="text-sm font-medium text-white">{user.name || user.email || user.mobileNumber}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {user.email && <span>{user.email}</span>}
                        {user.email && user.mobileNumber && <span className="mx-1">·</span>}
                        {user.mobileNumber && <span>{user.mobileNumber}</span>}
                      </div>
                    </button>
                  ))
                ) : behalfSearch.length >= 2 ? (
                  <div className="text-center py-6">
                    <p className="text-xs text-slate-400">No users found</p>
                    <button
                      onClick={() => {
                        const name = prompt('Enter player name for the booking:');
                        if (name) {
                          router.push(`/slots?userName=${encodeURIComponent(name)}`);
                        }
                      }}
                      className="mt-2 text-xs text-accent hover:underline cursor-pointer"
                    >
                      Book with custom name instead
                    </button>
                  </div>
                ) : (
                  <p className="text-center text-xs text-slate-500 py-6">Type at least 2 characters to search</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Category Tabs */}
      <div className="flex gap-1 overflow-x-auto pb-2 mb-4 scrollbar-hide">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => handleCategoryChange(tab.key)}
            className={`flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
              category === tab.key
                ? 'bg-accent text-primary'
                : 'bg-white/[0.04] text-slate-400 border border-white/[0.08] hover:border-primary/30'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-2 mb-5">
        <div className="bg-green-500/10 rounded-xl p-3 text-center">
          <div className="text-lg font-bold text-green-400">{summary.booked}</div>
          <div className="text-[10px] font-medium text-green-400 uppercase tracking-wider">Booked</div>
        </div>
        <div className="bg-white/[0.04] rounded-xl p-3 text-center">
          <div className="text-lg font-bold text-slate-400">{summary.cancelled}</div>
          <div className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Cancelled</div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white/[0.06] backdrop-blur-sm rounded-xl border border-white/[0.12] p-5 mb-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-accent" />
            <span className="text-sm font-semibold text-white uppercase tracking-wider">Filters</span>
          </div>
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
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-300 mb-1.5">Status</label>
            <select
              name="status"
              value={filters.status}
              onChange={handleFilterChange}
              className="w-full bg-white/[0.06] border border-white/[0.15] text-white rounded-lg px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 cursor-pointer"
            >
              <option value="">All</option>
              <option value="BOOKED">Booked</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>
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
              onChange={e => {
                setFilters(prev => ({ ...prev, date: e.target.value, from: '', to: '' }));
                setPagination(prev => ({ ...prev, page: 1 }));
              }}
              className="w-full bg-white/[0.06] border border-white/[0.15] text-white placeholder:text-slate-500 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent/20"
            />
          </div>
        </div>
        {showDateRange && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4 pt-4 border-t border-white/[0.08]">
            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1.5">From Date</label>
              <input
                type="date"
                name="from"
                value={filters.from}
                onChange={e => {
                  setFilters(prev => ({ ...prev, from: e.target.value, date: '' }));
                  setPagination(prev => ({ ...prev, page: 1 }));
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
                onChange={e => {
                  setFilters(prev => ({ ...prev, to: e.target.value, date: '' }));
                  setPagination(prev => ({ ...prev, page: 1 }));
                }}
                className="w-full bg-white/[0.06] border border-white/[0.15] text-white placeholder:text-slate-500 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent/20"
              />
            </div>
          </div>
        )}
      </div>

      {/* Sort Controls */}
      <div className="flex items-center gap-2 mb-3">
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

      {/* Bookings List */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin mb-2" />
          <span className="text-sm">Loading bookings...</span>
        </div>
      ) : bookings.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-12 h-12 rounded-full bg-white/[0.04] flex items-center justify-center mx-auto mb-3">
            <Calendar className="w-5 h-5 text-slate-400" />
          </div>
          <p className="text-sm text-slate-400 mb-4">No bookings found</p>
          <Link
            href="/slots"
            className="inline-flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent-light text-primary rounded-lg text-sm font-medium transition-colors"
          >
            <CalendarPlus className="w-4 h-4" />
            Book Your First Slot
          </Link>
        </div>
      ) : (
        <>
          {/* Mobile Cards */}
          <div className="md:hidden space-y-2.5">
            {bookings.map((booking) => {
              const status = statusConfig[booking.status] || statusConfig.BOOKED;
              const isEditing = editingPriceId === booking.id;
              const isActionLoading = actionLoading === booking.id;
              return (
                <div key={booking.id} className="bg-white/[0.04] backdrop-blur-sm rounded-xl border border-white/[0.08] p-3.5">
                  {/* Row 1: Name + Status */}
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-sm text-white truncate">{booking.playerName}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                        {booking.createdBy ? `By: ${booking.createdBy}` : booking.user?.email || booking.user?.mobileNumber}
                      </div>
                      {booking.status === 'CANCELLED' && booking.cancelledBy && (
                        <div className="text-[10px] text-red-400/80 mt-0.5 italic truncate">
                          Cancelled by: {booking.cancelledBy}
                        </div>
                      )}
                    </div>
                    <div className={`flex-shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${status.bg} ${status.text}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`}></span>
                      {status.label}
                    </div>
                  </div>

                  {/* Row 2: Date + Time + Price */}
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <span className="text-xs text-slate-400">{format(new Date(booking.date), 'MMM d')}</span>
                      <span className="text-xs text-white ml-1.5">
                        {new Date(booking.startTime).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}
                        {' - '}
                        {new Date(booking.endTime).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    {isEditing ? (
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-slate-400">₹</span>
                        <input
                          type="number"
                          value={editPriceValue}
                          onChange={e => setEditPriceValue(e.target.value)}
                          className="w-16 bg-white/[0.06] border border-accent/30 text-white rounded px-1.5 py-0.5 text-xs outline-none"
                          autoFocus
                        />
                        <button onClick={() => updatePrice(booking.id)} disabled={isActionLoading} className="p-0.5 text-green-400 hover:bg-green-500/10 rounded cursor-pointer">
                          <Check className="w-3 h-3" />
                        </button>
                        <button onClick={() => { setEditingPriceId(null); setEditPriceValue(''); }} className="p-0.5 text-slate-400 hover:bg-white/[0.06] rounded cursor-pointer">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ) : booking.price != null ? (
                      <button onClick={() => startEditPrice(booking)} className="flex items-center gap-0.5 text-xs font-medium text-white hover:text-accent transition-colors cursor-pointer">
                        <IndianRupee className="w-3 h-3" />
                        {booking.price}
                        <Pencil className="w-2.5 h-2.5 ml-0.5 opacity-40" />
                      </button>
                    ) : (
                      <button onClick={() => startEditPrice(booking)} className="text-[10px] text-slate-500 hover:text-accent cursor-pointer">Set price</button>
                    )}
                  </div>

                  {/* Row 3: Tags */}
                  <div className="flex flex-wrap items-center gap-1.5 mb-2.5">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                      booking.ballType === 'LEATHER' ? 'bg-red-500/10 text-red-400' :
                      booking.ballType === 'TENNIS' ? 'bg-green-500/10 text-green-400' :
                      'bg-blue-500/10 text-blue-400'
                    }`}>
                      {booking.ballType}
                    </span>
                    {booking.machineId && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.04] text-slate-400 font-medium">
                        {booking.machineId === 'GRAVITY' ? 'Gravity' : booking.machineId === 'YANTRA' ? 'Yantra' : booking.machineId === 'LEVERAGE_INDOOR' ? 'Indoor' : 'Outdoor'}
                      </span>
                    )}
                    {booking.pitchType && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.04] text-slate-400 font-medium">
                        {booking.pitchType === 'ASTRO' ? 'Astro' : booking.pitchType === 'CEMENT' ? 'Cement' : 'Natural'}
                      </span>
                    )}
                    {booking.operationMode && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${booking.operationMode === 'SELF_OPERATE' ? 'bg-orange-500/10 text-orange-400' : 'bg-blue-500/10 text-blue-400'}`}>
                        {booking.operationMode === 'SELF_OPERATE' ? 'Self' : 'Operator'}
                      </span>
                    )}
                  </div>

                  {/* Row 4: Actions */}
                  <div className="flex gap-2 pt-2.5 border-t border-white/[0.04]">
                    {booking.status === 'BOOKED' && (
                      <>
                        <button
                          onClick={() => copyToNextSlot(booking.id)}
                          disabled={isActionLoading}
                          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-medium text-accent bg-accent/10 rounded-lg hover:bg-accent/20 transition-colors cursor-pointer disabled:opacity-50"
                        >
                          <Copy className="w-3 h-3" />
                          Copy Next
                        </button>
                        <button
                          onClick={() => updateStatus(booking.id, 'CANCELLED')}
                          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-medium text-red-400 bg-red-500/10 rounded-lg hover:bg-red-500/20 transition-colors cursor-pointer"
                        >
                          <XCircle className="w-3 h-3" />
                          Cancel
                        </button>
                      </>
                    )}
                    {booking.status === 'CANCELLED' && (
                      <button
                        onClick={() => updateStatus(booking.id, 'BOOKED')}
                        className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-medium text-slate-400 bg-white/[0.04] rounded-lg hover:bg-white/[0.08] transition-colors cursor-pointer"
                      >
                        <RotateCcw className="w-3 h-3" />
                        Restore
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop Table */}
          <div className="hidden md:block bg-white/[0.04] backdrop-blur-sm rounded-xl border border-white/[0.08] overflow-hidden">
            <table className="w-full text-left">
              <thead className="bg-white/[0.02] border-b border-white/[0.06]">
                <tr>
                  <th className="px-5 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Customer</th>
                  <th className="px-5 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Date</th>
                  <th className="px-5 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Time</th>
                  <th className="px-5 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Type</th>
                  <th className="px-5 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Price</th>
                  <th className="px-5 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Status</th>
                  <th className="px-5 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {bookings.map((booking) => {
                  const status = statusConfig[booking.status] || statusConfig.BOOKED;
                  const isEditing = editingPriceId === booking.id;
                  const isActionLoading = actionLoading === booking.id;
                  return (
                    <tr key={booking.id} className="hover:bg-white/[0.04] transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="text-sm font-medium text-white">{booking.playerName}</div>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          {booking.createdBy ? `Created by: ${booking.createdBy}` : booking.user?.email || booking.user?.mobileNumber}
                        </div>
                        {booking.status === 'CANCELLED' && booking.cancelledBy && (
                          <div className="text-[10px] text-red-400/80 mt-0.5 italic">
                            {booking.cancellationReason || `Cancelled by: ${booking.cancelledBy}`}
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="text-sm text-white">{format(new Date(booking.date), 'MMM d, yyyy')}</div>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="text-sm text-white">
                          {new Date(booking.startTime).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}
                          {' - '}
                          {new Date(booking.endTime).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-1.5">
                          <span className={`w-2 h-2 rounded-full ${ballTypeConfig[booking.ballType] || 'bg-gray-400'}`}></span>
                          <span className="text-sm text-slate-300">{booking.ballType}</span>
                          {booking.operationMode && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${booking.operationMode === 'SELF_OPERATE' ? 'bg-orange-500/10 text-orange-400' : 'bg-blue-500/10 text-blue-400'}`}>
                              {booking.operationMode === 'SELF_OPERATE' ? 'Self' : 'Op'}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        {isEditing ? (
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-slate-400">₹</span>
                            <input
                              type="number"
                              value={editPriceValue}
                              onChange={e => setEditPriceValue(e.target.value)}
                              className="w-20 bg-white/[0.06] border border-accent/30 text-white rounded px-2 py-1 text-sm outline-none"
                              autoFocus
                              onKeyDown={e => { if (e.key === 'Enter') updatePrice(booking.id); if (e.key === 'Escape') { setEditingPriceId(null); setEditPriceValue(''); } }}
                            />
                            <button onClick={() => updatePrice(booking.id)} disabled={isActionLoading} className="p-1 text-green-400 hover:bg-green-500/10 rounded cursor-pointer">
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => { setEditingPriceId(null); setEditPriceValue(''); }} className="p-1 text-slate-400 hover:bg-white/[0.06] rounded cursor-pointer">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : booking.price != null ? (
                          <button onClick={() => startEditPrice(booking)} className="text-sm text-white hover:text-accent transition-colors cursor-pointer group">
                            <span className="flex items-center gap-0.5">
                              <IndianRupee className="w-3 h-3" />{booking.price}
                              <Pencil className="w-3 h-3 ml-1 opacity-0 group-hover:opacity-50" />
                            </span>
                            {booking.discountAmount > 0 && (
                              <div className="text-[10px] text-green-400">-{booking.discountAmount} discount</div>
                            )}
                          </button>
                        ) : (
                          <button onClick={() => startEditPrice(booking)} className="text-xs text-slate-500 hover:text-accent cursor-pointer">Set price</button>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ${status.bg} ${status.text}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`}></span>
                          {status.label}
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <div className="flex gap-1 justify-end">
                          {booking.status === 'BOOKED' && (
                            <>
                              <button
                                onClick={() => copyToNextSlot(booking.id)}
                                disabled={isActionLoading}
                                className="px-2.5 py-1.5 text-xs font-medium text-accent hover:bg-accent/10 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                                title="Copy to next consecutive slot"
                              >
                                <Copy className="w-3.5 h-3.5 inline mr-1" />
                                Copy Next
                              </button>
                              <button
                                onClick={() => updateStatus(booking.id, 'CANCELLED')}
                                className="px-2.5 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer"
                              >
                                Cancel
                              </button>
                            </>
                          )}
                          {booking.status === 'CANCELLED' && (
                            <button
                              onClick={() => updateStatus(booking.id, 'BOOKED')}
                              className="px-2.5 py-1.5 text-xs font-medium text-slate-400 hover:bg-white/[0.06] rounded-lg transition-colors cursor-pointer"
                            >
                              Restore
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="flex flex-col sm:flex-row items-center justify-between mt-4 gap-2">
              <div className="text-xs text-slate-400">
                Showing {(pagination.page - 1) * pagination.limit + 1}-{Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
                  disabled={pagination.page <= 1}
                  className="p-2 rounded-lg hover:bg-white/[0.06] transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4 text-slate-400" />
                </button>
                <span className="text-sm text-slate-300 px-2">
                  {pagination.page} / {pagination.totalPages}
                </span>
                <button
                  onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
                  disabled={pagination.page >= pagination.totalPages}
                  className="p-2 rounded-lg hover:bg-white/[0.06] transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function AdminBookings() {
  return (
    <Suspense fallback={
      <div className="flex flex-col items-center justify-center py-16 text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin mb-2" />
        <span className="text-sm">Loading...</span>
      </div>
    }>
      <AdminBookingsContent />
    </Suspense>
  );
}
