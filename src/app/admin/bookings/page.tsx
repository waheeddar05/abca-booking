'use client';

import { useState, useEffect, useCallback } from 'react';
import { format } from 'date-fns';
import { Search, Filter, CheckCircle, XCircle, RotateCcw, Calendar, Loader2, Download, ChevronLeft, ChevronRight, ArrowUpDown, IndianRupee } from 'lucide-react';

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

export default function AdminBookings() {
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<Category>('all');
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

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
            <Calendar className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Bookings</h1>
            <p className="text-xs text-slate-400">Manage all bookings</p>
          </div>
        </div>
        <button
          onClick={handleExport}
          className="inline-flex items-center gap-2 px-3 py-2 bg-white/[0.06] text-slate-300 rounded-lg text-xs font-medium hover:bg-white/[0.1] transition-colors cursor-pointer"
        >
          <Download className="w-3.5 h-3.5" />
          Export CSV
        </button>
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
      <div className="grid grid-cols-3 gap-2 mb-5">
        <div className="bg-green-500/10 rounded-xl p-3 text-center">
          <div className="text-lg font-bold text-green-400">{summary.booked}</div>
          <div className="text-[10px] font-medium text-green-400 uppercase tracking-wider">Booked</div>
        </div>
        <div className="bg-blue-500/10 rounded-xl p-3 text-center">
          <div className="text-lg font-bold text-blue-400">{summary.done}</div>
          <div className="text-[10px] font-medium text-blue-400 uppercase tracking-wider">Done</div>
        </div>
        <div className="bg-white/[0.04] rounded-xl p-3 text-center">
          <div className="text-lg font-bold text-slate-400">{summary.cancelled}</div>
          <div className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Cancelled</div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white/[0.04] backdrop-blur-sm rounded-xl border border-white/[0.08] p-4 mb-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400" />
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Filters</span>
          </div>
          <button
            onClick={() => setShowDateRange(!showDateRange)}
            className="text-xs text-primary font-medium cursor-pointer hover:underline"
          >
            {showDateRange ? 'Hide date range' : 'Date range filter'}
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">Status</label>
            <select
              name="status"
              value={filters.status}
              onChange={handleFilterChange}
              className="w-full bg-white/[0.04] border border-white/[0.1] text-white rounded-lg px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 cursor-pointer"
            >
              <option value="">All</option>
              <option value="BOOKED">Booked</option>
              <option value="CANCELLED">Cancelled</option>
              <option value="DONE">Done</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">Customer</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
              <input
                type="text"
                name="customer"
                placeholder="Search name or email..."
                value={filters.customer}
                onChange={handleFilterChange}
                className="w-full bg-white/[0.04] border border-white/[0.1] text-white placeholder:text-slate-500 rounded-lg pl-9 pr-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
              />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">Single Date</label>
            <input
              type="date"
              name="date"
              value={filters.date}
              onChange={e => {
                setFilters(prev => ({ ...prev, date: e.target.value, from: '', to: '' }));
                setPagination(prev => ({ ...prev, page: 1 }));
              }}
              className="w-full bg-white/[0.04] border border-white/[0.1] text-white placeholder:text-slate-500 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
            />
          </div>
        </div>
        {showDateRange && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3 pt-3 border-t border-white/[0.04]">
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">From Date</label>
              <input
                type="date"
                name="from"
                value={filters.from}
                onChange={e => {
                  setFilters(prev => ({ ...prev, from: e.target.value, date: '' }));
                  setPagination(prev => ({ ...prev, page: 1 }));
                }}
                className="w-full bg-white/[0.04] border border-white/[0.1] text-white placeholder:text-slate-500 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">To Date</label>
              <input
                type="date"
                name="to"
                value={filters.to}
                onChange={e => {
                  setFilters(prev => ({ ...prev, to: e.target.value, date: '' }));
                  setPagination(prev => ({ ...prev, page: 1 }));
                }}
                className="w-full bg-white/[0.04] border border-white/[0.1] text-white placeholder:text-slate-500 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
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
          <p className="text-sm text-slate-400">No bookings found</p>
        </div>
      ) : (
        <>
          {/* Mobile Cards */}
          <div className="md:hidden space-y-3">
            {bookings.map((booking) => {
              const status = statusConfig[booking.status] || statusConfig.BOOKED;
              return (
                <div key={booking.id} className="bg-white/[0.04] backdrop-blur-sm rounded-xl border border-white/[0.08] p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="font-semibold text-sm text-white">{booking.playerName}</div>
                    <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold ${status.bg} ${status.text}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`}></span>
                      {status.label}
                    </div>
                  </div>
                  <div className="text-xs text-slate-400 mb-1">
                    {booking.user?.email || booking.user?.mobileNumber}
                  </div>
                  <div className="text-xs text-slate-400 mb-1">
                    {format(new Date(booking.date), 'MMM d, yyyy')}
                  </div>
                  <div className="text-sm text-white mb-1">
                    {new Date(booking.startTime).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}
                    {' - '}
                    {new Date(booking.endTime).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}
                  </div>
                  <div className="flex items-center gap-3 mb-3">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${ballTypeConfig[booking.ballType] || 'bg-gray-400'}`}></span>
                      <span className="text-xs text-slate-400">{booking.ballType}</span>
                    </div>
                    {booking.operationMode && (
                      <span className={`text-xs px-1.5 py-0.5 rounded ${booking.operationMode === 'SELF_OPERATE' ? 'bg-orange-500/10 text-orange-400' : 'bg-blue-500/10 text-blue-400'}`}>
                        {booking.operationMode === 'SELF_OPERATE' ? 'Self' : 'Operator'}
                      </span>
                    )}
                    {booking.price != null && (
                      <div className="flex items-center gap-0.5 text-xs text-slate-300">
                        <IndianRupee className="w-3 h-3" />
                        {booking.price}
                        {booking.discountAmount > 0 && (
                          <span className="text-green-400 ml-1">(-{booking.discountAmount})</span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 pt-3 border-t border-white/[0.04]">
                    {booking.status === 'BOOKED' && (
                      <>
                        <button
                          onClick={() => updateStatus(booking.id, 'DONE')}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-green-400 bg-green-500/10 rounded-lg hover:bg-green-500/20 transition-colors cursor-pointer"
                        >
                          <CheckCircle className="w-3.5 h-3.5" />
                          Done
                        </button>
                        <button
                          onClick={() => updateStatus(booking.id, 'CANCELLED')}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-red-400 bg-red-500/10 rounded-lg hover:bg-red-500/20 transition-colors cursor-pointer"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          Cancel
                        </button>
                      </>
                    )}
                    {booking.status !== 'BOOKED' && (
                      <button
                        onClick={() => updateStatus(booking.id, 'BOOKED')}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-slate-400 bg-white/[0.04] rounded-lg hover:bg-white/[0.08] transition-colors cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
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
                  return (
                    <tr key={booking.id} className="hover:bg-white/[0.04] transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="text-sm font-medium text-white">{booking.playerName}</div>
                        <div className="text-xs text-slate-400">{booking.user?.email || booking.user?.mobileNumber}</div>
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
                        {booking.price != null ? (
                          <div className="text-sm text-white">
                            <span className="flex items-center gap-0.5">
                              <IndianRupee className="w-3 h-3" />{booking.price}
                            </span>
                            {booking.discountAmount > 0 && (
                              <div className="text-[10px] text-green-400">-{booking.discountAmount} discount</div>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-gray-300">-</span>
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
                                onClick={() => updateStatus(booking.id, 'DONE')}
                                className="px-2.5 py-1.5 text-xs font-medium text-green-400 hover:bg-green-500/10 rounded-lg transition-colors cursor-pointer"
                              >
                                Done
                              </button>
                              <button
                                onClick={() => updateStatus(booking.id, 'CANCELLED')}
                                className="px-2.5 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer"
                              >
                                Cancel
                              </button>
                            </>
                          )}
                          {booking.status !== 'BOOKED' && (
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
            <div className="flex items-center justify-between mt-4">
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
