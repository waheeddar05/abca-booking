'use client';

import { useEffect, useRef, useCallback } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  /** Optional warning text shown below message */
  warning?: string;
  /**
   * Optional red, must-read facility rule shown below `message` and
   * `warning`. Louder than `warning` on purpose — `warning` is amber
   * advice about the booking ("you'll be self-operating"), `notice` is a
   * rule the user has to act on before they arrive.
   */
  notice?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  warning,
  notice,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  // Focus trap & ESC to close
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement;
    confirmBtnRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      prev?.focus?.();
    };
  }, [open, onCancel]);

  // Prevent body scroll while open. Only touch the style while actually
  // open, and restore whatever was there before: this dialog is often
  // mounted (closed) inside another dialog that holds its own lock, and
  // the old unconditional `overflow = ''` on mount/close undid the parent's.
  useEffect(() => {
    if (!open) return;
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = before;
    };
  }, [open]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onCancel();
  }, [onCancel]);

  if (!open) return null;

  const isDanger = variant === 'danger';

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-desc"
    >
      {/*
        Three-row flex column so the dialog fits a phone: the header and
        the action buttons are pinned and only the message area scrolls.
        Before this, a multi-slot summary plus the red facility notice
        could push the Confirm button below the fold on a short screen
        with no way to scroll to it (the backdrop locks body scroll).
        `dvh` rather than `vh` so the mobile browser chrome is excluded.
      */}
      <div
        ref={dialogRef}
        className="bg-[#0f1d2f] border border-white/[0.12] rounded-2xl w-full max-w-sm shadow-2xl animate-slide-up flex flex-col max-h-[calc(100dvh-2rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2 px-5 pt-5 pb-3 flex-shrink-0">
          <h2 id="confirm-dialog-title" className="text-base font-bold text-white">
            {title}
          </h2>
          <button
            onClick={onCancel}
            className="p-1.5 -mt-1 -mr-1.5 text-slate-400 hover:text-white hover:bg-white/[0.06] rounded-lg transition-colors cursor-pointer flex-shrink-0"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body — the only scrollable region */}
        <div className="px-5 flex-1 min-h-0 overflow-y-auto overscroll-contain">
          <p id="confirm-dialog-desc" className="text-sm text-slate-300 leading-relaxed whitespace-pre-line">
            {message}
          </p>

          {warning && (
            <div className="mt-3 px-3 py-2.5 bg-amber-500/10 border border-amber-500/20 rounded-lg flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-amber-300 leading-relaxed">{warning}</p>
            </div>
          )}

          {notice && (
            <div
              role="alert"
              className="mt-3 px-3 py-2.5 bg-red-500/[0.12] border border-red-500/40 rounded-lg flex items-start gap-2"
            >
              <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
              <p className="text-xs font-semibold text-red-300 leading-relaxed whitespace-pre-line">
                {notice}
              </p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3 px-5 pt-4 pb-5 flex-shrink-0">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 min-w-0 px-3 py-2.5 text-sm font-medium text-slate-300 bg-white/[0.06] hover:bg-white/[0.1] rounded-xl transition-colors cursor-pointer disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmBtnRef}
            onClick={onConfirm}
            disabled={loading}
            className={`flex-1 min-w-0 px-3 py-2.5 text-sm font-bold rounded-xl transition-colors cursor-pointer disabled:opacity-50 ${
              isDanger
                ? 'bg-red-500 hover:bg-red-400 text-white'
                : 'bg-accent hover:bg-accent-light text-primary'
            }`}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                Processing...
              </span>
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
