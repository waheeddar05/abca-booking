'use client';

import { useState, useEffect, useCallback } from 'react';
import { format } from 'date-fns';
import { ClipboardList, Loader2, X, Calendar, Clock, IndianRupee, ChevronLeft, ChevronRight, User, Phone } from 'lucide-react';
import { ContactFooter } from '@/components/ContactFooter';
import { CancellationDialog } from '@/components/ui/CancellationDialog';
import { useToast } from '@/components/ui/Toast';
import {
  BOOKING_STATUS_CONFIG,
  BALL_TYPE_CONFIG,
  MACHINE_LABELS,
  PITCH_LABELS,
} from '@/lib/client-constants';
import { getDisplayStatus } from '@/lib/booking-utils';
import { BackButton } from '@/components/ui/BackButton';

interface BookingRefund {
  method: 'WALLET' | 'RAZORPAY';
  amount: number;
  refundedAt: string | null;
}

interface Booking {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  status: 'BOOKED' | 'CANCELLED' | 'DONE';
  playerName: string;
  ballType: string;
  pitchType: string | null;
  price: number | null;
  originalPrice: number | null;
  discountAmount: number | null;
  extraCharge: number | null;
  operationMode: 'WITH_OPERATOR' | 'SELF_OPERATE';
  cancelledBy: string | null;
  machineId: string | null;
  createdAt: string | null;
  isPackageBooking: boolean;
  paymentMethod: string | null;
  paymentStatus: string | null;
  refund: BookingRefund | null;
  operatorName: string | null;
  operatorMobile: string | null;
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

export default function BookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<BookingTab>('all');
  const [pagination, setPagination] = useState<PaginationInfo>({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const toast = useToast();

  const fetchBookings = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (activeTab !== 'all') params.set('tab', activeTab);
      params.set('page', String(pagination.page));
      params.set('limit', '20');
      const res = await fetch(`/api/bookings?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch bookings');
      const data = await res.json();
      setBookings(data.bookings);
      setPagination(data.pagination);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, [activeTab, pagination.page]);

  useEffect(() => {
    fetchBookings();
  }, [fetchBookings]);

  const handleCancelRequest = useCallback((bookingId: string) => {
    setConfirmCancelId(bookingId);
  }, []);

  const handleCancelConfirm = async (reason: string) => {
    if (!confirmCancelId) return;
    const bookingId = confirmCancelId;
    setConfirmCancelId(null);
    setCancellingId(bookingId);
    try {
      const res = await fetch('/api/slots/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId, cancellationReason: reason || undefined }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Cancellation failed');
      }

      const data = await res.json();
      if (data.refund) {
        const method = data.refund.method === 'WALLET' ? 'wallet' : 'bank account';
        toast.success(`Booking cancelled. ₹${data.refund.amount} refunded to ${method}`);
      } else {
        toast.success('Booking cancelled successfully');
      }
      fetchBookings();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setCancellingId(null);
    }
  };

  const statusConfig = BOOKING_STATUS_CONFIG;
  const ballTypeConfig = BALL_TYPE_CONFIG;
  const machineLabels = MACHINE_LABELS;
  const pitchLabels = PITCH_LABELS;

  return (
    <div className="max-w-2xl mx-auto px-4 py-5">
      {/* Background gradient */}
      <div className="fixed inset-0 -z-10 bg-gradient-to-br from-[#0a1628] via-[#132240] to-[#0d1f3c]"></div>
      <div className="fixed inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,rgba(212,168,67,0.05),transparent_60%)]"></div>

      {/* Page Header */}
      <BackButton />
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
          <ClipboardList className="w-5 h-5 text-accent" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">My Bookings</h1>
          <p className="text-xs text-slate-400">{pagination.total} total session{pagination.total !== 1 ? 's' : ''}</p>
        </div>
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
          <p className="text-sm font-medium text-slate-300 mb-1">No bookings yet</p>
          <p className="text-xs text-slate-400">Book your first practice session to get started</p>
        </div>
      ) : (
        <div>
          {/* Motivational quote banner */}
          <div className="py-3 px-4 rounded-xl bg-gradient-to-r from-accent/5 via-accent/10 to-accent/5 border border-accent/10 mb-4">
            <p className="text-center text-xs md:text-sm font-semibold text-accent italic">
              &ldquo;Sweat in Practice. Shine in Matches.&rdquo;
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {bookings.map((booking) => {
              const displayStatus = getDisplayStatus(booking);
              const status = statusConfig[displayStatus as keyof typeof statusConfig];
              const ballInfo = ballTypeConfig[booking.ballType] || { color: 'bg-gray-400', label: booking.ballType };
              const canCancel = booking.status === 'BOOKED' && new Date(booking.startTime) > new Date();
              const hasDiscount = booking.discountAmount && booking.discountAmount > 0;

              return (
                <div key={booking.id} className="bg-white/[0.04] backdrop-blur-sm rounded-xl border border-white/[0.08] p-4 transition-all hover:bg-white/[0.06] hover:border-white/[0.14] flex flex-col">
                  {/* Header: Status Badge + Cancel */}
                  <div className="flex items-center justify-between mb-3">
                    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ${status.bg} ${status.text}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`}></span>
                      {status.label}
                    </div>
                    {canCancel && (
                      <button
                        disabled={!!cancellingId}
                        onClick={() => handleCancelRequest(booking.id)}
                        className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-red-400 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                        {cancellingId === booking.id ? 'Cancelling...' : 'Cancel'}
                      </button>
                    )}
                  </div>

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

                  {/* Machine + Pitch + Tags */}
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
                    {booking.isPackageBooking && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 font-medium border border-purple-500/20">
                        Package
                      </span>
                    )}
                  </div>

                  {/* Operator Details */}
                  {booking.status === 'BOOKED' && booking.operatorName && (
                    <div className="bg-white/[0.03] rounded-lg px-3 py-2 mb-3 border border-white/[0.06]">
                      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Machine Operator</p>
                      <div className="flex items-center gap-2">
                        <User className="w-3 h-3 text-accent/60 flex-shrink-0" />
                        <span className="text-xs text-slate-300 font-medium">{booking.operatorName}</span>
                      </div>
                      {booking.operatorMobile && (
                        <div className="flex items-center gap-2 mt-0.5">
                          <Phone className="w-3 h-3 text-accent/60 flex-shrink-0" />
                          <a href={`tel:${booking.operatorMobile}`} className="text-xs text-accent hover:underline">{booking.operatorMobile}</a>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Price Row */}
                  <div className="mt-auto pt-3 border-t border-white/[0.06] flex items-center justify-between">
                    <span className="text-xs text-slate-400 truncate">{booking.playerName}</span>
                    {booking.price != null && (
                      <div className="flex items-center gap-1 shrink-0">
                        <IndianRupee className="w-3 h-3 text-slate-500" />
                        <span className="text-sm font-bold text-white">{booking.price}</span>
                        {hasDiscount && (
                          <span className="text-[10px] text-green-400 line-through ml-1">₹{booking.originalPrice}</span>
                        )}
                        {booking.extraCharge != null && booking.extraCharge > 0 && (
                          <span className="text-[10px] text-amber-400 ml-1">+₹{booking.extraCharge}</span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Cancelled by info */}
                  {booking.status === 'CANCELLED' && booking.cancelledBy && (
                    <div className="mt-2 text-[10px] text-red-400/70 italic">Cancelled by {booking.cancelledBy}</div>
                  )}

                  {/* Refund Info */}
                  {booking.status === 'CANCELLED' && booking.refund && (
                    <div className="mt-2 pt-2 border-t border-white/[0.04]">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-500/10 text-green-400">
                          <span className="w-1 h-1 rounded-full bg-green-400"></span>
                          Refund: ₹{booking.refund.amount}
                        </span>
                        <span className="text-[10px] text-slate-500">
                          via {booking.refund.method === 'WALLET' ? 'Wallet' : 'Bank (5-7 days)'}
                        </span>
                      </div>
                    </div>
                  )}
                  {booking.status === 'CANCELLED' && !booking.refund && booking.price && booking.price > 0 && booking.paymentStatus === 'PAID' && (
                    <div className="mt-2 pt-2 border-t border-white/[0.04]">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-400">
                        <span className="w-1 h-1 rounded-full bg-amber-400 animate-pulse"></span>
                        Refund pending
                      </span>
                    </div>
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

      {/* Cancel Confirm Dialog */}
      <CancellationDialog
        open={!!confirmCancelId}
        title="Cancel Booking"
        isAdmin={false}
        onConfirm={handleCancelConfirm}
        onCancel={() => setConfirmCancelId(null)}
      />

      <ContactFooter quote="Champions Train When Others Rest." />
    </div>
  );
}
