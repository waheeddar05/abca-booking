'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useState, useCallback } from 'react';
import { CalendarCheck, Clock, CheckCircle, Loader2, AlertCircle } from 'lucide-react';
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
  price: number | null;
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

export default function OperatorDashboard() {
  const { data: session, status: sessionStatus } = useSession();
  const [data, setData] = useState<OperatorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBookings = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/operator/bookings?date=today');
      if (!res.ok) {
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
    if (sessionStatus === 'authenticated') {
      fetchBookings();
    }
  }, [sessionStatus, fetchBookings]);

  if (sessionStatus === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="w-6 h-6 animate-spin text-accent" />
      </div>
    );
  }

  if (!session || !['OPERATOR', 'ADMIN'].includes(session.user?.role as string)) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="text-center">
          <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
          <p className="text-white text-lg font-medium">Access Denied</p>
          <p className="text-slate-400 text-sm mt-1">You need operator permissions to view this page.</p>
        </div>
      </div>
    );
  }

  // Group bookings by machine
  const groupedByMachine: Record<string, Booking[]> = {};
  if (data?.bookings) {
    for (const booking of data.bookings) {
      const key = booking.machineId || 'Unknown';
      if (!groupedByMachine[key]) {
        groupedByMachine[key] = [];
      }
      groupedByMachine[key].push(booking);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-white">Operator Dashboard</h1>
        <p className="text-slate-400 text-sm mt-1">
          Today&apos;s bookings for your assigned machines
        </p>
      </div>

      {/* Summary Stats */}
      {data && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-[#0f1d2f]/60 border border-white/[0.08] rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <CalendarCheck className="w-4 h-4 text-accent" />
              <span className="text-xs text-slate-400 font-medium">Total</span>
            </div>
            <p className="text-2xl font-bold text-white">{data.summary.total}</p>
          </div>
          <div className="bg-[#0f1d2f]/60 border border-white/[0.08] rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle className="w-4 h-4 text-blue-400" />
              <span className="text-xs text-slate-400 font-medium">Completed</span>
            </div>
            <p className="text-2xl font-bold text-white">{data.summary.done}</p>
          </div>
          <div className="bg-[#0f1d2f]/60 border border-white/[0.08] rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-4 h-4 text-green-400" />
              <span className="text-xs text-slate-400 font-medium">Upcoming</span>
            </div>
            <p className="text-2xl font-bold text-white">{data.summary.booked}</p>
          </div>
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
              onClick={fetchBookings}
              className="text-xs text-red-300 underline mt-1 cursor-pointer"
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {/* No bookings */}
      {!loading && !error && data && data.bookings.length === 0 && (
        <div className="bg-[#0f1d2f]/60 border border-white/[0.08] rounded-xl p-8 text-center">
          <CalendarCheck className="w-10 h-10 text-slate-500 mx-auto mb-3" />
          <p className="text-white font-medium">No bookings today</p>
          <p className="text-slate-400 text-sm mt-1">
            There are no bookings for your assigned machines today.
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

                  return (
                    <div
                      key={booking.id}
                      className="bg-[#0f1d2f]/60 border border-white/[0.08] rounded-xl p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          {/* Player Name */}
                          <p className="text-white font-medium text-sm truncate">
                            {booking.playerName}
                          </p>
                          {/* Time */}
                          <p className="text-slate-400 text-xs mt-1">
                            {formatTime(booking.startTime)} - {formatTime(booking.endTime)}
                          </p>
                          {/* Pitch type + mode */}
                          <div className="flex items-center gap-2 mt-2 flex-wrap">
                            {pitchLabel && (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-white/[0.06] text-slate-300">
                                {pitchLabel}
                              </span>
                            )}
                            <span className="text-xs px-2 py-0.5 rounded-full bg-white/[0.06] text-slate-300">
                              {booking.operationMode === 'SELF_OPERATE' ? 'Self Operate' : 'With Operator'}
                            </span>
                          </div>
                        </div>
                        {/* Status Badge */}
                        <div
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${statusConfig.bg} ${statusConfig.text}`}
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
