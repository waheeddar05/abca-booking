'use client';

import { useCallback, useEffect, useId, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface ShopDialogProps {
  title: string;
  subtitle?: string;
  /**
   * While true the dialog cannot be dismissed — a backdrop tap or ESC
   * halfway through an upload loop would leave requests in flight against
   * an unmounted component.
   */
  busy?: boolean;
  /**
   * True while a nested dialog (a delete confirm) is open on top. ESC and
   * backdrop taps then belong to that dialog — without this, one Escape
   * reached both document listeners and closed the whole thing.
   */
  suspendDismiss?: boolean;
  size?: 'sm' | 'md' | 'lg';
  onClose: () => void;
  children: ReactNode;
  /** Pinned below the scrollable body — the action buttons. */
  footer?: ReactNode;
}

const SIZE_CLASS = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
} as const;

/**
 * Dialog chrome for the Marketplace admin — the `ConfirmDialog` structure
 * (fixed backdrop, ESC to close, body scroll locked, three-row flex column
 * so header and actions stay pinned while only the body scrolls, `dvh` so
 * the mobile browser chrome is excluded) with a slot for arbitrary
 * content. Mounted only while open; unmounting is the close.
 */
export function ShopDialog({
  title,
  subtitle,
  busy = false,
  suspendDismiss = false,
  size = 'md',
  onClose,
  children,
  footer,
}: ShopDialogProps) {
  const titleId = useId();

  // Mount-only: lock the page behind and remember who had focus, so the
  // opener gets it back when the dialog unmounts. Kept apart from the
  // key listener below — that one re-subscribes whenever `onClose`
  // changes, and restoring focus on every parent re-render would pull it
  // out of the dialog mid-typing.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = before;
      prev?.focus?.();
    };
  }, []);

  const canDismiss = !busy && !suspendDismiss;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Let the nested dialog's own listener handle it.
      if (suspendDismiss) return;
      e.preventDefault();
      if (!busy) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [busy, suspendDismiss, onClose]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && canDismiss) onClose();
    },
    [canDismiss, onClose],
  );

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        className={`bg-[#0f1d2f] border border-white/[0.12] rounded-2xl w-full ${SIZE_CLASS[size]} shadow-2xl animate-slide-up flex flex-col max-h-[calc(100dvh-2rem)]`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 px-5 pt-5 pb-3 flex-shrink-0 border-b border-white/[0.06]">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-bold text-white truncate">
              {title}
            </h2>
            {subtitle && <p className="text-xs text-slate-400 mt-0.5 truncate">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="p-1.5 -mt-1 -mr-1.5 text-slate-400 hover:text-white hover:bg-white/[0.06] rounded-lg transition-colors cursor-pointer flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 flex-1 min-h-0 overflow-y-auto overscroll-contain">{children}</div>

        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 px-5 pt-3 pb-5 flex-shrink-0 border-t border-white/[0.06]">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
