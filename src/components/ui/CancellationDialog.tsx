'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { X, AlertTriangle } from 'lucide-react';

const ADMIN_CANCEL_REASONS = [
  'Unavailability of Machine Operator',
  'Electricity Issues',
  'Machine Not Working',
  'Other Reason',
];

interface CancellationDialogProps {
  open: boolean;
  title: string;
  playerName?: string;
  isAdmin?: boolean;
  loading?: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

export function CancellationDialog({
  open,
  title,
  playerName,
  isAdmin = false,
  loading = false,
  onConfirm,
  onCancel,
}: CancellationDialogProps) {
  const [selectedReason, setSelectedReason] = useState('');
  const [customReason, setCustomReason] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setSelectedReason('');
      setCustomReason('');
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onCancel]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onCancel();
  }, [onCancel]);

  const handleSubmit = () => {
    if (isAdmin) {
      const reason = selectedReason === 'Other Reason' ? customReason : selectedReason;
      onConfirm(reason);
    } else {
      onConfirm(customReason);
    }
  };

  const canSubmit = isAdmin ? (selectedReason && (selectedReason !== 'Other Reason' || customReason.trim())) : true;

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
    >
      <div
        ref={dialogRef}
        className="bg-[#0f1d2f] border border-white/[0.12] rounded-2xl w-full max-w-sm p-5 shadow-2xl animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4 text-red-400" />
            </div>
            <h2 className="text-base font-bold text-white">{title}</h2>
          </div>
          <button
            onClick={onCancel}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-white/[0.06] rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {playerName && (
          <p className="text-sm text-slate-300 mb-4">
            Cancel booking for <span className="font-semibold text-white">{playerName}</span>?
          </p>
        )}

        {isAdmin ? (
          <div className="space-y-2 mb-4">
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Cancellation Reason
            </label>
            {ADMIN_CANCEL_REASONS.map((reason) => (
              <label
                key={reason}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-all ${
                  selectedReason === reason
                    ? 'bg-red-500/10 border-red-500/30 text-white'
                    : 'bg-white/[0.02] border-white/[0.06] text-slate-300 hover:bg-white/[0.04]'
                }`}
              >
                <input
                  type="radio"
                  name="cancelReason"
                  value={reason}
                  checked={selectedReason === reason}
                  onChange={() => setSelectedReason(reason)}
                  className="sr-only"
                />
                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                  selectedReason === reason ? 'border-red-400' : 'border-slate-500'
                }`}>
                  {selectedReason === reason && (
                    <div className="w-2 h-2 rounded-full bg-red-400" />
                  )}
                </div>
                <span className="text-sm">{reason}</span>
              </label>
            ))}
            {selectedReason === 'Other Reason' && (
              <input
                type="text"
                placeholder="Enter specific reason..."
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                className="w-full bg-white/[0.04] border border-white/[0.1] rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-slate-500 outline-none focus:border-red-500/30 focus:ring-1 focus:ring-red-500/20 mt-2"
                autoFocus
              />
            )}
          </div>
        ) : (
          <div className="mb-4">
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Reason (optional)
            </label>
            <input
              type="text"
              placeholder="Why are you cancelling?"
              value={customReason}
              onChange={(e) => setCustomReason(e.target.value)}
              className="w-full bg-white/[0.04] border border-white/[0.1] rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-slate-500 outline-none focus:border-red-500/30 focus:ring-1 focus:ring-red-500/20"
            />
          </div>
        )}

        <div className="mt-3 px-3 py-2.5 bg-amber-500/10 border border-amber-500/20 rounded-lg flex items-start gap-2 mb-5">
          <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-amber-300 leading-relaxed">
            This action cannot be undone. The slot will be released for others to book.
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-300 bg-white/[0.06] hover:bg-white/[0.1] rounded-xl transition-colors cursor-pointer disabled:opacity-50"
          >
            Keep Booking
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !canSubmit}
            className="flex-1 px-4 py-2.5 text-sm font-bold bg-red-500 hover:bg-red-400 text-white rounded-xl transition-colors cursor-pointer disabled:opacity-50"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                Cancelling...
              </span>
            ) : (
              'Cancel Booking'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
