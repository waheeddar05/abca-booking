'use client';

/**
 * Page-level guard for admin surfaces that are only implemented for
 * one booking model. The sidebar already hides the link for the
 * unsupported model, but a direct URL hit (bookmark, deep link, copy-
 * paste) would otherwise render the legacy form on a center it doesn't
 * understand. This component renders a friendly empty state instead.
 *
 * Usage:
 *   <BookingModelGate allow={['MACHINE_PITCH']} surfaceLabel="Operators">
 *     <LegacyOperatorsPage />
 *   </BookingModelGate>
 */

import Link from 'next/link';
import { ArrowLeft, Info, Loader2 } from 'lucide-react';
import { useCenter } from '@/lib/center-context';

type BookingModel = 'MACHINE_PITCH' | 'RESOURCE_BASED';

const MODEL_LABEL: Record<BookingModel, string> = {
  MACHINE_PITCH: 'machine + pitch',
  RESOURCE_BASED: 'resource-based',
};

export function BookingModelGate({
  allow,
  surfaceLabel,
  children,
  altLink,
}: {
  /** Booking models for which the wrapped page is implemented. */
  allow: BookingModel[];
  /** Human label for the surface, e.g. "Operators", "Slots". */
  surfaceLabel: string;
  /** Optional fallback link to a related surface that *is* supported. */
  altLink?: { href: string; label: string };
  children: React.ReactNode;
}) {
  const { currentCenter, loading } = useCenter();

  // While the center is loading, show a spinner — don't flash the
  // gated content (or the empty state) prematurely.
  if (loading || !currentCenter) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-500">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  if (allow.includes(currentCenter.bookingModel)) {
    return <>{children}</>;
  }

  // Gated. Show a clear, non-scary message.
  return (
    <div className="max-w-xl mx-auto py-12 px-4">
      <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.04] p-6 text-center">
        <div className="w-10 h-10 rounded-xl bg-amber-500/10 mx-auto mb-3 flex items-center justify-center">
          <Info className="w-5 h-5 text-amber-400" />
        </div>
        <h2 className="text-base font-bold text-white mb-2">
          {surfaceLabel} isn&apos;t available for {currentCenter.name} yet
        </h2>
        <p className="text-xs text-slate-400 leading-relaxed mb-4">
          This admin page is currently only implemented for {MODEL_LABEL.MACHINE_PITCH} centers
          (e.g. ABCA). {currentCenter.name} runs on the {MODEL_LABEL[currentCenter.bookingModel]} model,
          which uses a different data shape — we&apos;re bringing parity in
          incrementally.
        </p>
        <div className="flex flex-wrap gap-2 justify-center">
          {altLink && (
            <Link
              href={altLink.href}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent/15 text-accent text-xs font-semibold hover:bg-accent/25 transition-all"
            >
              {altLink.label}
            </Link>
          )}
          <Link
            href="/admin"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-slate-300 text-xs font-semibold hover:bg-white/[0.08] transition-all"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
