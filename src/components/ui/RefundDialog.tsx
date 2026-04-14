'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Loader2, IndianRupee, AlertTriangle } from 'lucide-react';

interface RefundDialogProps {
  open: boolean;
  booking: {
    id: string;
    date: string;
    startTime: string;
    endTime: string;
    playerName: string;
    machineId?: string;
    price?: number;
    paymentAmount: number; // Original payment amount
    alreadyRefunded: number; // Sum of ALL previous refunds
    alreadyRefundedViaRazorpay: number; // Sum of only Razorpay refunds
    razorpayPortion: number; // Max refundable via Razorpay
  } | null;
  onConfirm: (data: { bookingId: string; refundAmount: number; refundMethod: 'razorpay' | 'wallet'; reason: string }) => Promise<void>;
  onCancel: () => void;
}

export function RefundDialog({ open, booking, onConfirm, onCancel }: RefundDialogProps) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'razorpay' | 'wallet'>('wallet');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);

  const remainingRefundable = booking ? booking.paymentAmount - booking.alreadyRefunded : 0;
  // Razorpay max should only subtract Razorpay refunds, not wallet refunds
  const razorpayMax = booking ? Math.min(remainingRefundable, booking.razorpayPortion - booking.alreadyRefundedViaRazorpay) : 0;

  useEffect(() => {
    if (open && booking) {
      setAmount(String(remainingRefundable));
      setMethod('wallet');
      setReason('');
      setError('');
      setLoading(false);
    }
  }, [open, booking, remainingRefundable]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [open, onCancel]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onCancel();
  }, [onCancel]);

  const handleSubmit = async () => {
    if (!booking) return;
    const refundAmount = parseFloat(amount);
    if (isNaN(refundAmount) || refundAmount <= 0) {
      setError('Enter a valid refund amount');
      return;
    }
    if (refundAmount > remainingRefundable) {
      setError(`Maximum refundable amount is ₹${remainingRefundable}`);
      return;
    }
    if (method === 'razorpay' && refundAmount > razorpayMax) {
      setError(`Maximum Razorpay refundable amount is ₹${razorpayMax}`);
      return;
    }
    if (!reason.trim()) {
      setError('Please provide a reason for the refund');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await onConfirm({
        bookingId: booking.id,
        refundAmount,
        refundMethod: method,
        reason: reason.trim(),
      });
    } catch (err: any) {
      setError(err?.message || 'Refund failed');
    } finally {
      setLoading(false);
    }
  };

  if (!open || !booking) return null;

  const formatTime = (t: string) => {
    try {
      return new Date(t).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
    } catch {
      return t;
    }
  };

  const formatDate = (d: string) => {
    try {
      return new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' });
    } catch {
      return d;
    }
  };

  const machineLabel = (id?: string) => {
    if (!id) return '';
    const map: Record<string, string> = { GRAVITY: 'Gravity', YANTRA: 'Yantra', LEVERAGE_INDOOR: 'Leverage Tennis (In)', LEVERAGE_OUTDOOR: 'Leverage Tennis (Out)' };
    return map[id] || id;
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
    >
      <div
        ref={dialogRef}
        className="bg-[#0f1d2f] border border-white/[0.12] rounded-2xl w-full max-w-md p-5 shadow-2xl animate-slide-up max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-base font-bold text-white">Initiate Refund</h2>
          <button
            onClick={onCancel}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-white/[0.06] rounded-lg transition-colors cursor-pointer flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Booking Summary */}
        <div className="bg-white/[0.04] rounded-xl p-3.5 mb-4 border border-white/[0.06]">
          <div className="text-sm font-semibold text-white mb-1">{booking.playerName}</div>
          <div className="text-xs text-slate-400 space-y-0.5">
            <div>{formatDate(booking.date)} &middot; {formatTime(booking.startTime)} - {formatTime(booking.endTime)}</div>
            {booking.machineId && <div>{machineLabel(booking.machineId)}</div>}
            <div className="flex items-center gap-1 text-slate-300">
              <IndianRupee className="w-3 h-3" />
              <span>Original: ₹{booking.paymentAmount}</span>
            </div>
          </div>
        </div>

        {/* Already Refunded */}
        {booking.alreadyRefunded > 0 && (
          <div className="flex items-center gap-2 mb-4 px-3 py-2.5 bg-amber-500/10 border border-amber-500/20 rounded-lg">
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <span className="text-xs text-amber-300">Already refunded: ₹{booking.alreadyRefunded}</span>
          </div>
        )}

        {/* Refund Amount */}
        <div className="mb-4">
          <label className="block text-[11px] font-semibold text-slate-300 mb-1.5">
            Refund Amount (max ₹{remainingRefundable})
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₹</span>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min={1}
              max={remainingRefundable}
              step="1"
              className="w-full bg-white/[0.06] border border-white/[0.15] text-white rounded-lg pl-8 pr-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent/20"
            />
          </div>
        </div>

        {/* Refund Method */}
        <div className="mb-4">
          <label className="block text-[11px] font-semibold text-slate-300 mb-2">Refund Method</label>
          <div className="space-y-2">
            <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors border-white/[0.08] hover:border-white/[0.15] has-[:checked]:border-accent/40 has-[:checked]:bg-accent/5">
              <input
                type="radio"
                name="refundMethod"
                value="wallet"
                checked={method === 'wallet'}
                onChange={() => setMethod('wallet')}
                className="mt-0.5 accent-[#c8ff00]"
              />
              <div>
                <div className="text-sm font-medium text-white">Wallet Credit (Instant)</div>
                <div className="text-[10px] text-slate-400 mt-0.5">Amount credited to user&apos;s wallet immediately</div>
              </div>
            </label>
            <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors border-white/[0.08] hover:border-white/[0.15] has-[:checked]:border-accent/40 has-[:checked]:bg-accent/5 ${razorpayMax <= 0 ? 'opacity-50 pointer-events-none' : ''}`}>
              <input
                type="radio"
                name="refundMethod"
                value="razorpay"
                checked={method === 'razorpay'}
                onChange={() => setMethod('razorpay')}
                disabled={razorpayMax <= 0}
                className="mt-0.5 accent-[#c8ff00]"
              />
              <div>
                <div className="text-sm font-medium text-white">Razorpay (5-7 business days)</div>
                <div className="text-[10px] text-slate-400 mt-0.5">
                  Refunded to original payment method
                  {razorpayMax > 0 && razorpayMax < remainingRefundable && (
                    <span className="text-amber-400"> &middot; Max ₹{razorpayMax} via Razorpay</span>
                  )}
                  {razorpayMax <= 0 && <span className="text-red-400"> &middot; No Razorpay amount to refund</span>}
                </div>
              </div>
            </label>
          </div>
        </div>

        {/* Reason */}
        <div className="mb-4">
          <label className="block text-[11px] font-semibold text-slate-300 mb-1.5">Reason for Refund</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for refund (visible to user)"
            rows={3}
            className="w-full bg-white/[0.06] border border-white/[0.15] text-white placeholder:text-slate-500 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 resize-none"
          />
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 px-3 py-2.5 bg-red-500/10 border border-red-500/20 rounded-lg">
            <p className="text-xs text-red-400">{error}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-300 bg-white/[0.06] hover:bg-white/[0.1] rounded-xl transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="flex-1 px-4 py-2.5 text-sm font-bold bg-accent hover:bg-accent-light text-primary rounded-xl transition-colors cursor-pointer disabled:opacity-50"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Processing...
              </span>
            ) : (
              'Confirm Refund'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
