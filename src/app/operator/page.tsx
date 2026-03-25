'use client';

import { useEffect, useState, useCallback } from 'react';
import { format } from 'date-fns';
import {
  ClipboardList, Loader2, Calendar, Clock, IndianRupee,
  ChevronLeft, ChevronRight, User, Phone, Headset,
} from 'lucide-react';
import {
  BOOKING_STATUS_CONFIG,
  BALL_TYPE_CONFIG,
  MACHINE_LABELS,
  PITCH_LABELS,
} from '@/lib/client-constants';
import { getDisplayStatus } from '@/lib/booking-utils';

interface Booking {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  status: 'BOOKED' | 'CANCELLED' | 'DONE';
  playerName: string;
  ballType: string;
  pitchType: string | null;
  machineId: string | null;
  price: number | null;
  originalPrice: number | null;
  discountAmount: number | null;
  extraCharge: number | null;
  operationMode: 'WITH_OPERATOR' | 'SELF_OPERATE';
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

type BookingTab = 'all' | 'upcoming' | 'inProgress' | 'completed' | 'cancelled';

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const TAB_OPTIONS = [
  { key: 'all', label: 'All' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'inProgress', label: 'In Progress' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
] as const;

export default function OperatorDashboard() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<BookingTab>('all');
  const [pagination, setPagination] = useState<PaginationInfo>({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [viewAllMachines, setViewAllMachines] = useState(false);

  const fetchBookings = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('date', 'all');
      if (activeTab !== 'all') params.set('tab', activeTab);
      params.set('page', String(pagination.page));
      params.set('limit', '20');
      if (viewAllMachines) params.set('viewAll', 'true');
      const res = await fetch(`/api/operator/bookings?${params.toString()}`);
      if (!res.ok) {
        if (res.status === 403) {
          throw new Error('Access denied. You need operator permissions.');
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
  }, [activeTab, pagination.page, viewAllMachines]);

  useEffect(() => {
    fetchBookings();
  }, [fetchBookings]);

  const statusConfig = BOOKING_STATUS_CONFIG;
  const ballTypeConfig = BALL_TYPE_CONFIG;
  const machineLabels = MACHINE_LABELS;
  const pitchLabels = PITCH_LABELS;

  return (
    <div className="max-w-2xl mx-auto">
      {/* Page Header */}
      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
            <ClipboardList className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">All Bookings</h1>
            <p className="text-xs text-slate-400">{pagination.total} total session{pagination.total !== 1 ? 's' : ''}</p>
          </div>
        </div>
        <button
          onClick={() => {
            setViewAllMachines(v => !v);
            setPagination(prev => ({ ...prev, page: 1 }));
          }}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex-shrink-0 cursor-pointer ${
            viewAllMachines
              ? 'bg-purple-500/15 text-purple-400 border border-purple-500/30'
              : 'bg-[#0f1d2f]/60 text-slate-400 border border-white/[0.08] hover:border-white/[0.15]'
          }`}
        >
          All Machines
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 mb-5 scrollbar-hide">
        {TAB_OPTIONS.map(tab => (
          <button
            key={tab.key}
            onClick={() => {
              setActiveTab(tab.key);
              setPagination(prev => ({ ...prev, page: 1 }));
            }}
            className={`flex-shrink-0 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeTab === tab.key
                ? 'bg-accent text-primary'
                : 'bg-white/[0.04] text-slate-400 border border-white/[0.08] hover:bg-white/[0.06]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin mb-2" />
          <span className="text-sm">Loading bookings...</span>
        </div>
      ) : error ? (
        <div className="text-center py-20">
          <p className="text-red-400 text-sm">{error}</p>
          <button onClick={fetchBookings} className="mt-3 text-sm text-accent font-medium cursor-pointer">Try again</button>
        </div>
      ) : bookings.length === 0 ? (
        <div className="text-center py-20">
          <div className="w-14 h-14 rounded-2xl bg-white/[0.04] flex items-center justify-center mx-auto mb-4">
            <ClipboardList className="w-6 h-6 text-slate-500" />
          </div>
          <p className="text-sm font-medium text-slate-300 mb-1">No bookings found</p>
          <p className="text-xs text-slate-400">
            {viewAllMachines ? 'No bookings across any machines.' : 'No bookings for your assigned machines.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {bookings.map((booking) => {
            const displayStatus = getDisplayStatus(booking);
            const status = statusConfig[displayStatus as keyof typeof statusConfig];
            const ballInfo = ballTypeConfig[booking.ballType] || { color: 'bg-gray-400', label: booking.ballType };

            return (
              <div key={booking.id} className="bg-white/[0.04] backdrop-blur-sm rounded-xl border border-white/[0.08] p-4 transition-all hover:bg-white/[0.06] hover:border-white/[0.14] flex flex-col">
                {/* Header: Status Badge */}
                <div className="flex items-center justify-between mb-3">
                  <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ${status.bg} ${status.text}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`}></span>
                    {status.label}
                  </div>
                  {booking.isPackageBooking && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 font-medium border border-purple-500/20">
                      {booking.packageName || 'Package'}
                    </span>
                  )}
                </div>

                {/* Customer Name */}
                <div className="flex items-center gap-2 mb-1">
                  <User className="w-3.5 h-3.5 text-accent/60 flex-shrink-0" />
                  <span className="text-sm font-semibold text-white truncate">{booking.customerName}</span>
                </div>

                {/* Customer Mobile */}
                {booking.customerMobile && (
                  <div className="flex items-center gap-2 mb-2">
                    <Phone className="w-3.5 h-3.5 text-accent/60 flex-shrink-0" />
                    <a href={`tel:${booking.customerMobile}`} className="text-xs text-accent hover:underline">{booking.customerMobile}</a>
                  </div>
                )}

                {/* Date & Time */}
                <div className="flex items-center gap-2 mb-1">
                  <Calendar className="w-3.5 h-3.5 text-accent/60 flex-shrink-0" />
                  <span className="text-sm font-medium text-slate-300">
                    {format(new Date(booking.date), 'EEE, MMM d')}
                  </span>
                </div>
                <div className="flex items-center gap-2 mb-3">
                  <Clock className="w-3.5 h-3.5 text-accent/60 flex-shrink-0" />
                  <span className="text-base font-bold text-white">
                    {new Date(booking.startTime).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}
                    {' – '}
                    {new Date(booking.endTime).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>

                {/* Machine + Pitch + Ball + Tags */}
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {booking.machineId && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.06] text-slate-300 font-medium border border-white/[0.06]">
                      {machineLabels[booking.machineId] || booking.machineId}
                    </span>
                  )}
                  {booking.pitchType && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.06] text-slate-300 font-medium border border-white/[0.06]">
                      {pitchLabels[booking.pitchType] || booking.pitchType}
                    </span>
                  )}
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                    booking.ballType === 'LEATHER' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
                    booking.ballType === 'TENNIS' ? 'bg-green-500/10 text-green-400 border border-green-500/20' :
                    'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                  }`}>
                    {ballInfo.label}
                  </span>
                  {!booking.isPackageBooking && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 font-medium border border-cyan-500/20">
                      Regular
                    </span>
                  )}
                </div>

                {/* Operator Details */}
                <div className="bg-white/[0.03] rounded-lg px-3 py-2 mb-3 border border-white/[0.06]">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Machine Operator</p>
                  {booking.operationMode === 'SELF_OPERATE' ? (
                    <div className="flex items-center gap-2">
                      <Headset className="w-3 h-3 text-amber-400/60 flex-shrink-0" />
                      <span className="text-xs text-amber-400 font-medium">Self Operate</span>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <Headset className="w-3 h-3 text-accent/60 flex-shrink-0" />
                        <span className="text-xs text-slate-300 font-medium">{booking.operatorName || 'Not assigned'}</span>
                      </div>
                      {booking.operatorMobile && (
                        <div className="flex items-center gap-2 mt-0.5">
                          <Phone className="w-3 h-3 text-accent/60 flex-shrink-0" />
                          <a href={`tel:${booking.operatorMobile}`} className="text-xs text-accent hover:underline">{booking.operatorMobile}</a>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Price Row */}
                <div className="mt-auto pt-3 border-t border-white/[0.06] flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    {booking.price != null && (
                      <div className="flex items-center gap-1 shrink-0">
                        <IndianRupee className="w-3 h-3 text-slate-500" />
                        <span className="text-sm font-bold text-white">{booking.price}</span>
                        {booking.discountAmount != null && booking.discountAmount > 0 && (
                          <span className="text-[10px] text-green-400 line-through ml-1">₹{booking.originalPrice}</span>
                        )}
                        {booking.extraCharge != null && booking.extraCharge > 0 && (
                          <span className="text-[10px] text-amber-400 ml-1">+₹{booking.extraCharge}</span>
                        )}
                      </div>
                    )}
                  </div>
                  {booking.paymentMethod && (
                    <span className="text-[10px] text-slate-500">
                      {booking.paymentMethod === 'CASH' ? 'Cash' : booking.paymentMethod === 'WALLET' ? 'Wallet' : 'Online'}
                    </span>
                  )}
                </div>

                {/* Cancelled by info */}
                {booking.status === 'CANCELLED' && booking.cancelledBy && (
                  <div className="mt-2 text-[10px] text-red-400/70 italic">Cancelled by {booking.cancelledBy}</div>
                )}

                {/* Booked on */}
                {booking.createdAt && (
                  <div className="mt-2 pt-2 border-t border-white/[0.04]">
                    <span className="text-[10px] text-slate-500">
                      Booked {format(new Date(booking.createdAt), 'MMM d, yyyy')}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
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
              onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
              disabled={pagination.page <= 1}
              className="p-1.5 rounded-lg hover:bg-white/[0.06] transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4 text-slate-400" />
            </button>
            <span className="text-sm text-slate-300 px-2">{pagination.page}</span>
            <button
              onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
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
