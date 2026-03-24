'use client';

import { useEffect, useState, useCallback } from 'react';
import { CalendarCheck, Clock, CheckCircle, Loader2, AlertCircle, ChevronLeft, ChevronRight, Phone } from 'lucide-react';
import { MACHINE_LABELS, BOOKING_STATUS_CONFIG, PITCH_TYPE_LABELS } from '@/lib/client-constants';

interface BookingUser {
  name: string | null;
  email: string | null;
  mobileNumber: string | null;
}

interface Booking {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  status: keyof typeof BOOKING_STATUS_CONFIG;
  playerName: string;
  machineId: string | null;
  pitchType: string | null;
  ballType: string;
  operationMode: string;
  operatorId: string | null;
  price: number | null;
  paymentMethod: string | null;
  paymentStatus: string | null;
  user: BookingUser | null;
}

interface OperatorData {
  bookings: Booking[];
  summary: {
    total: number;
    booked: number;
    done: number;
    cancelled: number;
  };
  machineIds: string[];
  assignedMachineIds: string[];
  currentOperatorId: string;
  viewAll: boolean;
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  });
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

function toDateString(date: Date): string {
  // Format as YYYY-MM-DD in IST
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

export default function OperatorBookingsPage() {
  const [data, setData] = useState<OperatorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [dateMode, setDateMode] = useState<'day' | 'all'>('day');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showOnlyMine, setShowOnlyMine] = useState(false);
  const [viewAllMachines, setViewAllMachines] = useState(false);

  const fetchBookings = useCallback(async (date: Date, mode: 'day' | 'all' = 'day', viewAll = false) => {
    try {
      setLoading(true);
      setError(null);
      const params = mode === 'all' ? 'date=all' : `date=${toDateString(date)}`;
      const viewAllParam = viewAll ? '&viewAll=true' : '';
      const res = await fetch(`/api/operator/bookings?${params}${viewAllParam}`);
      if (!res.ok) {
        if (res.status === 403) {
          setError('Access denied. You need operator permissions.');
          return;
        }
        const err = await res.json();
        throw new Error(err.error || 'Failed to fetch bookings');
      }
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBookings(selectedDate, dateMode, viewAllMachines);
  }, [selectedDate, dateMode, viewAllMachines, fetchBookings]);

  const goToPreviousDay = () => {
    setSelectedDate(prev => {
      const d = new Date(prev);
      d.setDate(d.getDate() - 1);
      return d;
    });
  };

  const goToNextDay = () => {
    setSelectedDate(prev => {
      const d = new Date(prev);
      d.setDate(d.getDate() + 1);
      return d;
    });
  };

  const goToToday = () => setSelectedDate(new Date());

  const isToday = toDateString(selectedDate) === toDateString(new Date());

  // Filter bookings by status and assignment
  const filteredBookings = data?.bookings.filter(b => {
    if (statusFilter !== 'all' && b.status !== statusFilter) return false;
    if (showOnlyMine && b.operatorId !== data?.currentOperatorId) return false;
    return true;
  }) ?? [];

  const myBookingsCount = data?.bookings.filter(b => b.operatorId === data?.currentOperatorId).length ?? 0;

  // Group bookings by machine
  const groupedByMachine: Record<string, Booking[]> = {};
  for (const booking of filteredBookings) {
    const key = booking.machineId || 'Unknown';
    if (!groupedByMachine[key]) {
      groupedByMachine[key] = [];
    }
    groupedByMachine[key].push(booking);
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-white">Bookings</h1>
        <p className="text-slate-400 text-sm mt-1">
          {viewAllMachines ? 'Viewing bookings across all machines' : 'View bookings for your assigned machines'}
        </p>
      </div>

      {/* Date Mode Toggle + View All */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => { setDateMode('day'); setSelectedDate(new Date()); }}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
            dateMode === 'day'
              ? 'bg-accent/15 text-accent border border-accent/30'
              : 'bg-[#0f1d2f]/60 text-slate-400 border border-white/[0.08] hover:border-white/[0.15]'
          }`}
        >
          By Day
        </button>
        <button
          onClick={() => setDateMode('all')}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
            dateMode === 'all'
              ? 'bg-accent/15 text-accent border border-accent/30'
              : 'bg-[#0f1d2f]/60 text-slate-400 border border-white/[0.08] hover:border-white/[0.15]'
          }`}
        >
          All Upcoming
        </button>
        <div className="ml-auto">
          <button
            onClick={() => setViewAllMachines(v => !v)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              viewAllMachines
                ? 'bg-purple-500/15 text-purple-400 border border-purple-500/30'
                : 'bg-[#0f1d2f]/60 text-slate-400 border border-white/[0.08] hover:border-white/[0.15]'
            }`}
          >
            {viewAllMachines ? 'All Machines' : 'All Machines'}
          </button>
        </div>
      </div>

      {/* Date Navigation (day mode only) */}
      {dateMode === 'day' && (
        <div className="flex items-center justify-between bg-[#0f1d2f]/60 border border-white/[0.08] rounded-xl p-3">
          <button
            onClick={goToPreviousDay}
            className="p-2 rounded-lg hover:bg-white/[0.06] text-slate-400 hover:text-white transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-3">
            <div className="text-center">
              <p className="text-white font-medium text-sm">{formatDate(selectedDate)}</p>
              {!isToday && (
                <button
                  onClick={goToToday}
                  className="text-accent text-xs mt-0.5 hover:underline"
                >
                  Go to today
                </button>
              )}
              {isToday && (
                <span className="text-accent text-xs mt-0.5">Today</span>
              )}
            </div>
            <input
              type="date"
              value={toDateString(selectedDate)}
              onChange={(e) => {
                if (e.target.value) {
                  const [y, m, d] = e.target.value.split('-').map(Number);
                  setSelectedDate(new Date(y, m - 1, d));
                }
              }}
              className="bg-white/[0.06] border border-white/[0.08] text-slate-300 text-xs rounded-lg px-2 py-1.5 outline-none cursor-pointer"
            />
          </div>
          <button
            onClick={goToNextDay}
            className="p-2 rounded-lg hover:bg-white/[0.06] text-slate-400 hover:text-white transition-colors"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* My Bookings / All toggle */}
      {data && !loading && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowOnlyMine(false)}
            className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
              !showOnlyMine
                ? 'bg-accent/15 text-accent border border-accent/30'
                : 'bg-[#0f1d2f]/60 text-slate-400 border border-white/[0.08] hover:border-white/[0.15]'
            }`}
          >
            All Bookings ({data.summary.total})
          </button>
          <button
            onClick={() => setShowOnlyMine(true)}
            className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
              showOnlyMine
                ? 'bg-accent/15 text-accent border border-accent/30'
                : 'bg-[#0f1d2f]/60 text-slate-400 border border-white/[0.08] hover:border-white/[0.15]'
            }`}
          >
            My Bookings ({myBookingsCount})
          </button>
        </div>
      )}

      {/* Summary Stats */}
      {data && !loading && (
        <div className="grid grid-cols-4 gap-2">
          <button
            onClick={() => setStatusFilter('all')}
            className={`rounded-xl p-3 text-center transition-colors border ${
              statusFilter === 'all'
                ? 'bg-accent/10 border-accent/30'
                : 'bg-[#0f1d2f]/60 border-white/[0.08] hover:border-white/[0.15]'
            }`}
          >
            <p className="text-lg font-bold text-white">{data.summary.total}</p>
            <p className="text-[10px] text-slate-400 font-medium">All</p>
          </button>
          <button
            onClick={() => setStatusFilter('BOOKED')}
            className={`rounded-xl p-3 text-center transition-colors border ${
              statusFilter === 'BOOKED'
                ? 'bg-green-500/10 border-green-500/30'
                : 'bg-[#0f1d2f]/60 border-white/[0.08] hover:border-white/[0.15]'
            }`}
          >
            <p className="text-lg font-bold text-white">{data.summary.booked}</p>
            <p className="text-[10px] text-slate-400 font-medium">Upcoming</p>
          </button>
          <button
            onClick={() => setStatusFilter('DONE')}
            className={`rounded-xl p-3 text-center transition-colors border ${
              statusFilter === 'DONE'
                ? 'bg-blue-500/10 border-blue-500/30'
                : 'bg-[#0f1d2f]/60 border-white/[0.08] hover:border-white/[0.15]'
            }`}
          >
            <p className="text-lg font-bold text-white">{data.summary.done}</p>
            <p className="text-[10px] text-slate-400 font-medium">Done</p>
          </button>
          <button
            onClick={() => setStatusFilter('CANCELLED')}
            className={`rounded-xl p-3 text-center transition-colors border ${
              statusFilter === 'CANCELLED'
                ? 'bg-red-500/10 border-red-500/30'
                : 'bg-[#0f1d2f]/60 border-white/[0.08] hover:border-white/[0.15]'
            }`}
          >
            <p className="text-lg font-bold text-white">{data.summary.cancelled}</p>
            <p className="text-[10px] text-slate-400 font-medium">Cancelled</p>
          </button>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-accent" />
          <span className="ml-2 text-slate-400">Loading bookings...</span>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
          <div>
            <p className="text-red-400 text-sm font-medium">{error}</p>
            <button
              onClick={() => fetchBookings(selectedDate)}
              className="text-xs text-red-300 underline mt-1 cursor-pointer"
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {/* No bookings */}
      {!loading && !error && data && filteredBookings.length === 0 && (
        <div className="bg-[#0f1d2f]/60 border border-white/[0.08] rounded-xl p-8 text-center">
          <CalendarCheck className="w-10 h-10 text-slate-500 mx-auto mb-3" />
          <p className="text-white font-medium">No bookings found</p>
          <p className="text-slate-400 text-sm mt-1">
            {statusFilter !== 'all'
              ? `No ${statusFilter.toLowerCase()} bookings for this date.`
              : 'There are no bookings for your assigned machines on this date.'}
          </p>
        </div>
      )}

      {/* Bookings grouped by machine */}
      {!loading && !error && Object.keys(groupedByMachine).length > 0 && (
        <div className="space-y-6">
          {Object.entries(groupedByMachine).map(([machineId, bookings]) => (
            <div key={machineId}>
              <h2 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-accent"></span>
                {MACHINE_LABELS[machineId] || machineId}
                <span className="text-slate-500 font-normal">({bookings.length})</span>
              </h2>
              <div className="space-y-2">
                {bookings.map((booking) => {
                  const statusConfig = BOOKING_STATUS_CONFIG[booking.status] || BOOKING_STATUS_CONFIG.BOOKED;
                  const pitchLabel = booking.pitchType
                    ? PITCH_TYPE_LABELS[booking.pitchType]?.label || booking.pitchType
                    : null;
                  const isMyBooking = booking.operatorId === data?.currentOperatorId;

                  return (
                    <div
                      key={booking.id}
                      className={`rounded-xl p-4 ${
                        isMyBooking
                          ? 'bg-accent/[0.06] border border-accent/20'
                          : 'bg-[#0f1d2f]/60 border border-white/[0.08]'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          {/* Player Name */}
                          <div className="flex items-center gap-2">
                            <p className="text-white font-medium text-sm truncate">
                              {booking.playerName}
                            </p>
                            {isMyBooking && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-accent/20 text-accent font-semibold shrink-0">
                                YOURS
                              </span>
                            )}
                          </div>
                          {/* Customer contact */}
                          {booking.user?.mobileNumber && (
                            <a
                              href={`tel:${booking.user.mobileNumber}`}
                              className="text-accent text-xs flex items-center gap-1 mt-0.5"
                            >
                              <Phone className="w-3 h-3" />
                              {booking.user.mobileNumber}
                            </a>
                          )}
                          {/* Date (shown in All mode) + Time */}
                          <p className="text-slate-400 text-xs mt-1 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {dateMode === 'all' && (
                              <span className="text-slate-300 font-medium">
                                {new Date(booking.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' })}
                                {' · '}
                              </span>
                            )}
                            {formatTime(booking.startTime)} - {formatTime(booking.endTime)}
                          </p>
                          {/* Tags */}
                          <div className="flex items-center gap-2 mt-2 flex-wrap">
                            {pitchLabel && (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-white/[0.06] text-slate-300">
                                {pitchLabel}
                              </span>
                            )}
                            <span className="text-xs px-2 py-0.5 rounded-full bg-white/[0.06] text-slate-300">
                              {booking.operationMode === 'SELF_OPERATE' ? 'Self Operate' : 'With Operator'}
                            </span>
                            {booking.price != null && booking.price > 0 && (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-white/[0.06] text-slate-300">
                                ₹{booking.price}
                              </span>
                            )}
                            {booking.paymentMethod && (
                              <span className={`text-xs px-2 py-0.5 rounded-full ${
                                booking.paymentStatus === 'PAID'
                                  ? 'bg-green-500/10 text-green-400'
                                  : 'bg-yellow-500/10 text-yellow-400'
                              }`}>
                                {booking.paymentMethod === 'WALLET' ? 'Wallet' : booking.paymentMethod === 'CASH' ? 'Cash' : 'Online'}
                                {booking.paymentStatus === 'PAID' ? '' : ' (Pending)'}
                              </span>
                            )}
                          </div>
                        </div>
                        {/* Status Badge */}
                        <div
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium shrink-0 ${statusConfig.bg} ${statusConfig.text}`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${statusConfig.dot}`}></span>
                          {statusConfig.label}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
