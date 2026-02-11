'use client';

import { useState, useEffect } from 'react';
import { format, addDays } from 'date-fns';
import { Search, Filter, CheckCircle, XCircle, RotateCcw, Calendar, Loader2 } from 'lucide-react';

export default function AdminBookings() {
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [filters, setFilters] = useState({
    status: '',
    customer: '',
  });

  const fetchBookings = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        date: format(selectedDate, 'yyyy-MM-dd'),
        ...(filters.status && { status: filters.status }),
        ...(filters.customer && { customer: filters.customer }),
      });
      const res = await fetch(`/api/admin/bookings?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setBookings(data);
      }
    } catch (error) {
      console.error('Failed to fetch bookings', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBookings();
  }, [selectedDate, filters]);

  const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFilters({ ...filters, [e.target.name]: e.target.value });
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

  const statusConfig: Record<string, { label: string; bg: string; text: string; dot: string }> = {
    BOOKED: { label: 'Booked', bg: 'bg-green-50', text: 'text-green-700', dot: 'bg-green-500' },
    DONE: { label: 'Done', bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500' },
    CANCELLED: { label: 'Cancelled', bg: 'bg-gray-50', text: 'text-gray-500', dot: 'bg-gray-400' },
  };

  const ballTypeConfig: Record<string, string> = {
    TENNIS: 'bg-green-500',
    LEATHER: 'bg-red-500',
    MACHINE: 'bg-blue-500',
  };

  const bookedCount = bookings.filter(b => b.status === 'BOOKED').length;
  const doneCount = bookings.filter(b => b.status === 'DONE').length;
  const cancelledCount = bookings.filter(b => b.status === 'CANCELLED').length;

  return (
    <div>
      <div className="flex items-center gap-3 mb-5">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Calendar className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">All Bookings</h1>
          <p className="text-xs text-gray-400">Manage bookings by date</p>
        </div>
      </div>

      {/* 7-Day Date Selector */}
      <div className="mb-5">
        <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wider">Select Date</label>
        <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-hide">
          {[0, 1, 2, 3, 4, 5, 6].map((days) => {
            const date = addDays(new Date(), days);
            const isSelected = format(selectedDate, 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd');
            const isToday = days === 0;
            return (
              <button
                key={days}
                onClick={() => setSelectedDate(date)}
                className={`flex-shrink-0 w-16 py-3 rounded-xl text-center transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-primary text-white shadow-md shadow-primary/20'
                    : 'bg-white text-gray-600 border border-gray-200 hover:border-primary/30'
                }`}
              >
                <div className={`text-[10px] uppercase font-medium ${isSelected ? 'text-white/70' : 'text-gray-400'}`}>
                  {isToday ? 'Today' : format(date, 'EEE')}
                </div>
                <div className="text-lg font-bold mt-0.5">{format(date, 'd')}</div>
                <div className={`text-[10px] ${isSelected ? 'text-white/60' : 'text-gray-400'}`}>
                  {format(date, 'MMM')}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Day Summary */}
      <div className="grid grid-cols-3 gap-2 mb-5">
        <div className="bg-green-50 rounded-xl p-3 text-center">
          <div className="text-lg font-bold text-green-700">{bookedCount}</div>
          <div className="text-[10px] font-medium text-green-600 uppercase tracking-wider">Booked</div>
        </div>
        <div className="bg-blue-50 rounded-xl p-3 text-center">
          <div className="text-lg font-bold text-blue-700">{doneCount}</div>
          <div className="text-[10px] font-medium text-blue-600 uppercase tracking-wider">Done</div>
        </div>
        <div className="bg-gray-50 rounded-xl p-3 text-center">
          <div className="text-lg font-bold text-gray-500">{cancelledCount}</div>
          <div className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Cancelled</div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 mb-5">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-gray-400" />
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Filters</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-medium text-gray-400 mb-1">Status</label>
            <select
              name="status"
              value={filters.status}
              onChange={handleFilterChange}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 cursor-pointer"
            >
              <option value="">All</option>
              <option value="BOOKED">Booked</option>
              <option value="CANCELLED">Cancelled</option>
              <option value="DONE">Done</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-gray-400 mb-1">Customer</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
              <input
                type="text"
                name="customer"
                placeholder="Search name or email..."
                value={filters.customer}
                onChange={handleFilterChange}
                className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Bookings List */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin mb-2" />
          <span className="text-sm">Loading bookings...</span>
        </div>
      ) : bookings.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3">
            <Calendar className="w-5 h-5 text-gray-400" />
          </div>
          <p className="text-sm text-gray-500">No bookings for {format(selectedDate, 'EEE, MMM d')}</p>
        </div>
      ) : (
        <>
          {/* Mobile Cards */}
          <div className="md:hidden space-y-3">
            {bookings.map((booking) => {
              const status = statusConfig[booking.status] || statusConfig.BOOKED;
              return (
                <div key={booking.id} className="bg-white rounded-xl border border-gray-100 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="font-semibold text-sm text-gray-900">{booking.playerName}</div>
                    <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold ${status.bg} ${status.text}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`}></span>
                      {status.label}
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 mb-1">
                    {booking.user?.email || booking.user?.mobileNumber}
                  </div>
                  <div className="text-sm text-gray-900 mb-1">
                    {new Date(booking.startTime).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}
                    {' - '}
                    {new Date(booking.endTime).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}
                  </div>
                  <div className="flex items-center gap-1.5 mb-3">
                    <span className={`w-2 h-2 rounded-full ${ballTypeConfig[booking.ballType] || 'bg-gray-400'}`}></span>
                    <span className="text-xs text-gray-500">{booking.ballType}</span>
                  </div>
                  <div className="flex gap-2 pt-3 border-t border-gray-50">
                    {booking.status === 'BOOKED' && (
                      <>
                        <button
                          onClick={() => updateStatus(booking.id, 'DONE')}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-green-600 bg-green-50 rounded-lg hover:bg-green-100 transition-colors cursor-pointer"
                        >
                          <CheckCircle className="w-3.5 h-3.5" />
                          Done
                        </button>
                        <button
                          onClick={() => updateStatus(booking.id, 'CANCELLED')}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-red-500 bg-red-50 rounded-lg hover:bg-red-100 transition-colors cursor-pointer"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          Cancel
                        </button>
                      </>
                    )}
                    {booking.status !== 'BOOKED' && (
                      <button
                        onClick={() => updateStatus(booking.id, 'BOOKED')}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-gray-600 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
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
          <div className="hidden md:block bg-white rounded-xl border border-gray-100 overflow-hidden">
            <table className="w-full text-left">
              <thead className="bg-gray-50/80 border-b border-gray-100">
                <tr>
                  <th className="px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Customer</th>
                  <th className="px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Time</th>
                  <th className="px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Type</th>
                  <th className="px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Status</th>
                  <th className="px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {bookings.map((booking) => {
                  const status = statusConfig[booking.status] || statusConfig.BOOKED;
                  return (
                    <tr key={booking.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="text-sm font-medium text-gray-900">{booking.playerName}</div>
                        <div className="text-xs text-gray-400">{booking.user?.email || booking.user?.mobileNumber}</div>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="text-sm text-gray-900">
                          {new Date(booking.startTime).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}
                          {' - '}
                          {new Date(booking.endTime).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-1.5">
                          <span className={`w-2 h-2 rounded-full ${ballTypeConfig[booking.ballType] || 'bg-gray-400'}`}></span>
                          <span className="text-sm text-gray-600">{booking.ballType}</span>
                        </div>
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
                                className="px-2.5 py-1.5 text-xs font-medium text-green-600 hover:bg-green-50 rounded-lg transition-colors cursor-pointer"
                              >
                                Done
                              </button>
                              <button
                                onClick={() => updateStatus(booking.id, 'CANCELLED')}
                                className="px-2.5 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                              >
                                Cancel
                              </button>
                            </>
                          )}
                          {booking.status !== 'BOOKED' && (
                            <button
                              onClick={() => updateStatus(booking.id, 'BOOKED')}
                              className="px-2.5 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
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
        </>
      )}
    </div>
  );
}
