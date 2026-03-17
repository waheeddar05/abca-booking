'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { format } from 'date-fns';
import { useSearchParams } from 'next/navigation';
import { Search, Filter, XCircle, RotateCcw, Calendar, Loader2, Download, ChevronLeft, ChevronRight, ChevronDown, ArrowUpDown, IndianRupee, Copy, Pencil, X, Check, CalendarPlus, UserPlus, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { CancellationDialog } from '@/components/ui/CancellationDialog';
import { TextInputDialog } from '@/components/ui/TextInputDialog';
import { RefundDialog } from '@/components/ui/RefundDialog';
import { useToast } from '@/components/ui/Toast';
import { getDisplayStatus } from '@/lib/booking-utils';

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
    machineId: '',
  });
  const [showDateRange, setShowDateRange] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
  const [editPriceValue, setEditPriceValue] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showBookOnBehalf, setShowBookOnBehalf] = useState(false);
  const [operators, setOperators] = useState<Array<{ id: string; name: string }>>([]);
  const [changingOperator, setChangingOperator] = useState<string | null>(null);
  const toast = useToast();

  // Dialog states
  const [cancelDialog, setCancelDialog] = useState<{ bookingId: string; playerName: string } | null>(null);
  const [restoreDialog, setRestoreDialog] = useState<{ bookingId: string; playerName: string } | null>(null);
  const [copyDialog, setCopyDialog] = useState<string | null>(null);
  const [customNameDialog, setCustomNameDialog] = useState(false);
  const [refundDialog, setRefundDialog] = useState<{
    id: string; date: string; startTime: string; endTime: string; playerName: string;
    machineId?: string; price?: number; paymentAmount: number; alreadyRefunded: number; alreadyRefundedViaRazorpay: number; razorpayPortion: number;
  } | null>(null);

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
      if (filters.machineId) params.set('machineId', filters.machineId);
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

  // Fetch operators list for assignment dropdown
  useEffect(() => {
    fetch('/api/admin/operators')
      .then(res => res.json())
      .then(data => {
        if (data.operators) {
          setOperators(data.operators.map((op: any) => ({ id: op.id, name: op.name || op.email })));
        }
      })
      .catch(() => { });
  }, []);

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

  const handleOperatorChange = async (bookingId: string, operatorId: string | null) => {
    setChangingOperator(bookingId);
    try {
      const res = await fetch('/api/admin/bookings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId, operatorId }),
      });
      if (res.ok) {
        toast.success('Operator updated');
        fetchBookings();
      } else {
        const data = await res.json();
        toast.error(data.error || 'Failed to update operator');
      }
    } catch {
      toast.error('Failed to update operator');
    } finally {
      setChangingOperator(null);
    }
  };

  const handleCancelClick = (bookingId: string, playerName: string) => {
    setCancelDialog({ bookingId, playerName });
  };

  const handleRestoreClick = (bookingId: string, playerName: string) => {
    setRestoreDialog({ bookingId, playerName });
  };

  const handleCancelConfirm = async (reason: string) => {
    const bookingId = cancelDialog?.bookingId;
    if (!bookingId) return;
    setCancelDialog(null);
    setActionLoading(bookingId);
    try {
      const res = await fetch('/api/admin/bookings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId, status: 'CANCELLED', cancellationReason: reason }),
      });
      if (res.ok) {
        toast.success('Booking cancelled successfully');
        fetchBookings();
      } else {
        const data = await res.json();
        toast.error(data.error || 'Failed to cancel booking');
      }
    } catch {
      toast.error('Failed to cancel booking');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRestoreConfirm = async () => {
    const bookingId = restoreDialog?.bookingId;
    if (!bookingId) return;
    setRestoreDialog(null);
    setActionLoading(bookingId);
    try {
      const res = await fetch('/api/admin/bookings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId, status: 'BOOKED' }),
      });
      if (res.ok) {
        toast.success('Booking restored successfully');
        fetchBookings();
      } else {
        const data = await res.json();
        toast.error(data.error || 'Failed to restore booking');
      }
    } catch {
      toast.error('Failed to restore booking');
    } finally {
      setActionLoading(null);
    }
  };

  const updatePrice = async (bookingId: string) => {
    const price = parseFloat(editPriceValue);
    if (isNaN(price) || price < 0) {
      toast.error('Please enter a valid price');
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
        toast.error(data.error || 'Price update failed');
      }
    } catch {
      toast.error('Failed to update price');
    } finally {
      setActionLoading(null);
    }
  };

  const handleCopyClick = (bookingId: string) => {
    setCopyDialog(bookingId);
  };

  const handleCopyConfirm = async () => {
    const bookingId = copyDialog;
    if (!bookingId) return;
    setCopyDialog(null);
    setActionLoading(bookingId);
    try {
      const res = await fetch('/api/admin/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId, action: 'copy_next_slot' }),
      });
      if (res.ok) {
        toast.success('Booking copied to next slot');
        fetchBookings();
      } else {
        const data = await res.json();
        toast.error(data.error || 'Copy failed');
      }
    } catch {
      toast.error('Failed to copy booking');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRefundClick = async (booking: any) => {
    try {
      const refunds = booking.refunds || [];
      const alreadyRefunded = refunds.reduce((sum: number, r: any) => r.status !== 'FAILED' ? sum + r.amount : sum, 0);
      const alreadyRefundedViaRazorpay = refunds.reduce((sum: number, r: any) => (r.status !== 'FAILED' && r.method === 'RAZORPAY') ? sum + r.amount : sum, 0);

      // For ONLINE bookings, fetch the Payment record to get the Razorpay portion
      let razorpayPortion = 0;
      if (booking.paymentMethod === 'ONLINE') {
        try {
          const res = await fetch(`/api/admin/payments?bookingId=${booking.id}`);
          if (res.ok) {
            const data = await res.json();
            const payment = data.payments?.[0];
            razorpayPortion = payment?.amount || 0;
          }
        } catch { /* ignore — Razorpay option just won't be available */ }
      }

      setRefundDialog({
        id: booking.id, date: booking.date, startTime: booking.startTime, endTime: booking.endTime,
        playerName: booking.playerName, machineId: booking.machineId, price: booking.price,
        paymentAmount: booking.price || 0, alreadyRefunded, alreadyRefundedViaRazorpay, razorpayPortion,
      });
    } catch { toast.error('Failed to load refund details'); }
  };

  const handleRefundConfirm = async (data: { bookingId: string; refundAmount: number; refundMethod: 'razorpay' | 'wallet'; reason: string }) => {
    const res = await fetch('/api/admin/refund', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Refund failed');
    toast.success(`Refund of ₹${data.refundAmount} initiated via ${data.refundMethod === 'razorpay' ? 'Razorpay' : 'Wallet'}`);
    setRefundDialog(null);
    fetchBookings();
  };

  const getRefundBadge = (booking: any) => {
    const refunds = booking.refunds || [];
    if (refunds.length === 0) return null;
    const activeRefunds = refunds.filter((r: any) => r.status !== 'FAILED');
    const totalRefunded = activeRefunds.reduce((sum: number, r: any) => sum + r.amount, 0);
    if (totalRefunded <= 0) return null;
    const hasInitiated = activeRefunds.some((r: any) => r.status === 'INITIATED');
    if (hasInitiated && totalRefunded < (booking.price || Infinity)) {
      return { label: 'Refund Initiated', bg: 'bg-blue-500/10', text: 'text-blue-400' };
    }
    if (totalRefunded >= (booking.price || 0) && booking.price) {
      return { label: 'Refunded', bg: 'bg-green-500/10', text: 'text-green-400' };
    }
    return { label: 'Partially Refunded', bg: 'bg-yellow-500/10', text: 'text-yellow-400' };
  };

  const canRefund = (booking: any) => {
    // Admin can refund any booking with a price (wallet credit works for all payment methods)
    if (booking.packageBooking) return false;
    if (!booking.price || booking.price <= 0) return false;
    const refunds = booking.refunds || [];
    const totalRefunded = refunds.reduce((sum: number, r: any) => r.status !== 'FAILED' ? sum + r.amount : sum, 0);
    return totalRefunded < booking.price;
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
    BOOKED: { label: 'Upcoming', bg: 'bg-green-500/10', text: 'text-green-400', dot: 'bg-green-500' },
    IN_PROGRESS: { label: 'In Progress', bg: 'bg-emerald-500/10', text: 'text-emerald-400', dot: 'bg-emerald-500 animate-pulse' },
    DONE: { label: 'Completed', bg: 'bg-blue-500/10', text: 'text-blue-400', dot: 'bg-blue-500' },
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
      <AdminPageHeader icon={Calendar} title="Bookings" description="Manage all bookings">
        <button
          onClick={() => setShowBookOnBehalf(true)}
          className="inline-flex items-center justify-center gap-2 px-3 py-2.5 bg-accent text-primary rounded-xl text-xs font-bold hover:bg-accent-light transition-all cursor-pointer shadow-sm shadow-accent/20"
        >
          <UserPlus className="w-3.5 h-3.5" />
          Book on Behalf
        </button>
        <button
          onClick={handleExport}
          className="inline-flex items-center justify-center gap-2 px-3 py-2.5 bg-white/[0.03] text-slate-300 rounded-xl text-xs font-medium hover:bg-white/[0.08] transition-all cursor-pointer border border-white/[0.08]"
        >
          <Download className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Export</span> CSV
        </button>
      </AdminPageHeader>

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
                    onClick={() => setCustomNameDialog(true)}
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

      {/* Category Tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1 mb-3 scrollbar-hide">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => handleCategoryChange(tab.key)}
            className={`flex-shrink-0 px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${category === tab.key
              ? 'bg-accent text-primary shadow-sm shadow-accent/20'
              : 'bg-white/[0.03] text-slate-500 border border-white/[0.07] hover:border-white/[0.15] hover:text-slate-300'
              }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Summary - inline on mobile */}
      <div className="flex items-center gap-3 mb-3 px-1">
        <span className="text-xs text-slate-400">Showing <span className="text-white font-semibold">{summary.total}</span></span>
        <span className="text-[10px] text-green-400 font-medium">{summary.booked} booked</span>
        <span className="text-[10px] text-slate-500 font-medium">{summary.cancelled} cancelled</span>
      </div>

      {/* Filters - collapsible on mobile */}
      <div className="bg-white/[0.03] backdrop-blur-sm rounded-2xl border border-white/[0.07] p-3 sm:p-5 mb-4 hover:border-white/[0.12] transition-colors">
        <div className="flex items-center justify-between mb-0 sm:mb-4">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-2 sm:cursor-default"
          >
            <Filter className="w-4 h-4 text-accent" />
            <span className="text-xs sm:text-sm font-semibold text-white uppercase tracking-wider">Filters</span>
            <ChevronDown className={`w-3.5 h-3.5 text-slate-400 sm:hidden transition-transform ${showFilters ? 'rotate-180' : ''}`} />
          </button>
          <button
            onClick={() => setShowDateRange(!showDateRange)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-all ${showDateRange
              ? 'bg-accent/15 text-accent border border-accent/30'
              : 'bg-white/[0.06] text-slate-300 border border-white/[0.12] hover:border-accent/30 hover:text-accent'
              }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            {showDateRange ? 'Hide Date Range' : 'Date Range Filter'}
          </button>
        </div>
        <div className={`grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mt-3 ${showFilters ? '' : 'hidden sm:grid'}`}>
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
          <div>
            <label className="block text-[11px] font-semibold text-slate-300 mb-1.5">Machine</label>
            <select
              name="machineId"
              value={filters.machineId}
              onChange={handleFilterChange}
              className="w-full bg-white/[0.06] border border-white/[0.15] text-white rounded-lg px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 cursor-pointer"
            >
              <option value="">All Machines</option>
              <option value="GRAVITY">Gravity</option>
              <option value="YANTRA">Yantra</option>
              <option value="LEVERAGE_INDOOR">Leverage Indoor</option>
              <option value="LEVERAGE_OUTDOOR">Leverage Outdoor</option>
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
        {showDateRange && showFilters && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3 mt-3 sm:mt-4 pt-3 sm:pt-4 border-t border-white/[0.08]">
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
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Sort by:</span>
        <button
          onClick={() => handleSort('date')}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium cursor-pointer ${sortBy === 'date' ? 'bg-accent/15 text-accent' : 'text-slate-400 hover:bg-white/[0.06]'
            }`}
        >
          Date
          {sortBy === 'date' && <ArrowUpDown className="w-3 h-3" />}
        </button>
        <button
          onClick={() => handleSort('createdAt')}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium cursor-pointer ${sortBy === 'createdAt' ? 'bg-accent/15 text-accent' : 'text-slate-400 hover:bg-white/[0.06]'
            }`}
        >
          Created
          {sortBy === 'createdAt' && <ArrowUpDown className="w-3 h-3" />}
        </button>
      </div>

      {/* Bookings List */}
      {
        loading ? (
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
                const displayStatus = getDisplayStatus(booking);
                const status = statusConfig[displayStatus] || statusConfig.BOOKED;
                const isEditing = editingPriceId === booking.id;
                const isActionLoading = actionLoading === booking.id;
                return (
                  <div key={booking.id} className="bg-white/[0.03] backdrop-blur-sm rounded-xl border border-white/[0.07] p-3 hover:border-white/[0.12] transition-colors">
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
                      <div className="flex flex-col items-end gap-1">
                        <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${status.bg} ${status.text}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`}></span>
                          {status.label}
                        </div>
                        {(() => { const badge = getRefundBadge(booking); return badge ? (
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-[9px] font-semibold ${badge.bg} ${badge.text}`}>{badge.label}</span>
                        ) : null; })()}
                      </div>
                    </div>

                    {/* Row 2: Date + Time + Price */}
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <div>
                          <span className="text-xs text-slate-400">{format(new Date(booking.date), 'MMM d')}</span>
                          <span className="text-xs text-white ml-1.5">
                            {new Date(booking.startTime).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}
                            {' - '}
                            {new Date(booking.endTime).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        {booking.createdAt && (
                          <div className="text-[9px] text-slate-500 mt-0.5">
                            Created: {format(new Date(booking.createdAt), 'MMM d, h:mm a')}
                          </div>
                        )}
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
                    <div className="flex flex-wrap items-center gap-1 mb-2">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${booking.ballType === 'LEATHER' ? 'bg-red-500/10 text-red-400' :
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

                    {/* Operator Assignment */}
                    {booking.operationMode === 'WITH_OPERATOR' && (
                      <div className="flex items-center gap-2 mb-2.5">
                        <span className="text-[10px] text-slate-500">Operator:</span>
                        <select
                          value={booking.operatorId || ''}
                          onChange={(e) => handleOperatorChange(booking.id, e.target.value || null)}
                          disabled={changingOperator === booking.id}
                          className="text-[11px] bg-white/[0.06] border border-white/[0.08] text-slate-300 rounded px-2 py-1 outline-none cursor-pointer disabled:opacity-50"
                        >
                          <option value="">Unassigned</option>
                          {operators.map(op => (
                            <option key={op.id} value={op.id}>{op.name}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* Row 4: Actions */}
                    <div className="flex gap-1.5 pt-2 border-t border-white/[0.04]">
                      {booking.status === 'BOOKED' && (
                        <>
                          <button
                            onClick={() => handleCopyClick(booking.id)}
                            disabled={isActionLoading}
                            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-medium text-accent bg-accent/10 rounded-lg hover:bg-accent/20 transition-colors cursor-pointer disabled:opacity-50"
                          >
                            <Copy className="w-3 h-3" />
                            Copy Next
                          </button>
                          <button
                            onClick={() => handleCancelClick(booking.id, booking.playerName)}
                            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-medium text-red-400 bg-red-500/10 rounded-lg hover:bg-red-500/20 transition-colors cursor-pointer"
                          >
                            <XCircle className="w-3 h-3" />
                            Cancel
                          </button>
                        </>
                      )}
                      {booking.status === 'CANCELLED' && (
                        <button
                          onClick={() => handleRestoreClick(booking.id, booking.playerName)}
                          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-medium text-slate-400 bg-white/[0.04] rounded-lg hover:bg-white/[0.08] transition-colors cursor-pointer"
                        >
                          <RotateCcw className="w-3 h-3" />
                          Restore
                        </button>
                      )}
                      {canRefund(booking) && (
                        <button
                          onClick={() => handleRefundClick(booking)}
                          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-medium text-purple-400 bg-purple-500/10 rounded-lg hover:bg-purple-500/20 transition-colors cursor-pointer"
                        >
                          <Undo2 className="w-3 h-3" />
                          Refund
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop Table */}
            <div className="hidden md:block bg-white/[0.03] backdrop-blur-sm rounded-2xl border border-white/[0.07] overflow-hidden">
              <table className="w-full text-left">
                <thead className="bg-white/[0.02] border-b border-white/[0.06]">
                  <tr>
                    <th className="px-5 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Customer</th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Date / Time</th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Created</th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Type</th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Price</th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Operator</th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Status</th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {bookings.map((booking) => {
                    const displayStatus = getDisplayStatus(booking);
                    const status = statusConfig[displayStatus] || statusConfig.BOOKED;
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
                          <div className="text-sm text-white mt-0.5">
                            {new Date(booking.startTime).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}
                            {' - '}
                            {new Date(booking.endTime).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </td>
                        <td className="px-5 py-3.5">
                          {booking.createdAt ? (
                            <>
                              <div className="text-xs text-slate-300">{format(new Date(booking.createdAt), 'MMM d, yyyy')}</div>
                              <div className="text-[10px] text-slate-500 mt-0.5">{new Date(booking.createdAt).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}</div>
                            </>
                          ) : (
                            <span className="text-[10px] text-slate-500">—</span>
                          )}
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
                          {booking.operationMode === 'WITH_OPERATOR' ? (
                            <select
                              value={booking.operatorId || ''}
                              onChange={(e) => handleOperatorChange(booking.id, e.target.value || null)}
                              disabled={changingOperator === booking.id}
                              className="text-xs bg-white/[0.06] border border-white/[0.08] text-slate-300 rounded px-2 py-1.5 outline-none cursor-pointer disabled:opacity-50 min-w-[100px]"
                            >
                              <option value="">Unassigned</option>
                              {operators.map(op => (
                                <option key={op.id} value={op.id}>{op.name}</option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-[10px] text-slate-500">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex flex-col gap-1">
                            <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ${status.bg} ${status.text} w-fit`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`}></span>
                              {status.label}
                            </div>
                            {(() => { const badge = getRefundBadge(booking); return badge ? (
                              <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${badge.bg} ${badge.text} w-fit`}>{badge.label}</span>
                            ) : null; })()}
                          </div>
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <div className="flex gap-1 justify-end">
                            {booking.status === 'BOOKED' && (
                              <>
                                <button
                                  onClick={() => handleCopyClick(booking.id)}
                                  disabled={isActionLoading}
                                  className="px-2.5 py-1.5 text-xs font-medium text-accent hover:bg-accent/10 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                                  title="Copy to next consecutive slot"
                                >
                                  <Copy className="w-3.5 h-3.5 inline mr-1" />
                                  Copy Next
                                </button>
                                <button
                                  onClick={() => handleCancelClick(booking.id, booking.playerName)}
                                  className="px-2.5 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer"
                                >
                                  Cancel
                                </button>
                              </>
                            )}
                            {booking.status === 'CANCELLED' && (
                              <button
                                onClick={() => handleRestoreClick(booking.id, booking.playerName)}
                                className="px-2.5 py-1.5 text-xs font-medium text-slate-400 hover:bg-white/[0.06] rounded-lg transition-colors cursor-pointer"
                              >
                                Restore
                              </button>
                            )}
                            {canRefund(booking) && (
                              <button
                                onClick={() => handleRefundClick(booking)}
                                className="px-2.5 py-1.5 text-xs font-medium text-purple-400 hover:bg-purple-500/10 rounded-lg transition-colors cursor-pointer"
                              >
                                <Undo2 className="w-3.5 h-3.5 inline mr-1" />
                                Refund
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
        )
      }

      {/* Cancellation Dialog */}
      <CancellationDialog
        open={!!cancelDialog}
        title="Cancel Booking"
        playerName={cancelDialog?.playerName}
        isAdmin={true}
        loading={!!actionLoading}
        onConfirm={handleCancelConfirm}
        onCancel={() => setCancelDialog(null)}
      />

      {/* Restore Confirm Dialog */}
      <ConfirmDialog
        open={!!restoreDialog}
        title="Restore Booking"
        message={`Are you sure you want to restore the booking for "${restoreDialog?.playerName}"?`}
        confirmLabel="Restore"
        cancelLabel="Cancel"
        onConfirm={handleRestoreConfirm}
        onCancel={() => setRestoreDialog(null)}
      />

      {/* Copy Next Slot Confirm */}
      <ConfirmDialog
        open={!!copyDialog}
        title="Copy to Next Slot"
        message="Copy this booking to the next consecutive 30-minute slot?"
        confirmLabel="Copy"
        cancelLabel="Cancel"
        onConfirm={handleCopyConfirm}
        onCancel={() => setCopyDialog(null)}
      />

      {/* Custom Name for Book on Behalf */}
      <TextInputDialog
        open={customNameDialog}
        title="Book with Custom Name"
        label="Player Name"
        placeholder="Enter player name..."
        confirmLabel="Continue"
        onConfirm={(name) => {
          setCustomNameDialog(false);
          router.push(`/slots?userName=${encodeURIComponent(name)}`);
        }}
        onCancel={() => setCustomNameDialog(false)}
      />

      {/* Refund Dialog */}
      <RefundDialog
        open={!!refundDialog}
        booking={refundDialog}
        onConfirm={handleRefundConfirm}
        onCancel={() => setRefundDialog(null)}
      />
    </div >
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
