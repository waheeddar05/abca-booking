'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { BellRing, Loader2 } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import { loginHref } from '@/lib/login-href';

interface NotifyMeButtonProps {
  productId: string;
  /** Whether the viewer has already registered interest (from the product API). */
  interested: boolean;
  /** From the product API — never from a session hook. */
  signedIn: boolean;
  onChange: (interested: boolean) => void;
  className?: string;
}

/**
 * "Notify me when available" — the pre-launch call to action. Toggles the
 * viewer's interest row through POST / DELETE
 * `/api/shop/products/[id]/interest`. Anonymous visitors (and a stale
 * session that the API answers with 401) are sent to sign in.
 */
export function NotifyMeButton({ productId, interested, signedIn, onChange, className = '' }: NotifyMeButtonProps) {
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  // An anonymous tap goes to the landing page with the login modal open,
  // and comes back to this product once the code is verified.
  const signInHref = loginHref(pathname);

  const handleClick = async () => {
    if (!signedIn) {
      router.push(signInHref);
      return;
    }
    setPending(true);
    try {
      const res = await fetch(`/api/shop/products/${encodeURIComponent(productId)}/interest`, {
        method: interested ? 'DELETE' : 'POST',
      });
      if (res.status === 401) {
        router.push(signInHref);
        return;
      }
      const isJson = res.headers.get('content-type')?.includes('application/json') ?? false;
      const body: unknown = isJson ? await res.json() : null;
      if (!res.ok) {
        const message =
          body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
            ? (body as { error: string }).error
            : 'Something went wrong';
        throw new Error(message);
      }
      const next =
        body && typeof body === 'object' && typeof (body as { interested?: unknown }).interested === 'boolean'
          ? (body as { interested: boolean }).interested
          : !interested;
      onChange(next);
      if (next) {
        toast.success('You’re on the list', 'The store will get in touch when this is available.');
      } else {
        toast.info('Reminder removed', 'You won’t be notified about this product.');
      }
    } catch (err) {
      toast.error('Couldn’t update', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setPending(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      aria-pressed={interested}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] ${
        interested
          ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20'
          : 'bg-accent hover:bg-accent-light text-primary'
      } ${className}`}
    >
      {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <BellRing className="w-4 h-4" />}
      {interested ? 'You’ll be notified ✓' : 'Notify me when available'}
    </button>
  );
}
