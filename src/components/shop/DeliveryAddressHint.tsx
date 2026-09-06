'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Loader2, MapPin, Truck } from 'lucide-react';
import { PROFILE_PATH } from '@/lib/marketplace';
import { formatAddressSummary, type UserAddressView } from '@/lib/addresses';
import { loginHref } from '@/lib/login-href';

export interface DefaultAddressState {
  loading: boolean;
  /** The viewer's default delivery address, or null when they have none. */
  address: UserAddressView | null;
  /** The list couldn't be read (network / server). Signed-out reads as "none". */
  error: boolean;
  retry: () => void;
}

const IDLE: Omit<DefaultAddressState, 'retry'> = { loading: false, address: null, error: false };

/**
 * The viewer's default delivery address from `GET /api/user/addresses`,
 * for the order message and the hint below the price. Fetches only when
 * `enabled` (signed in and the store is taking orders); otherwise reports
 * "none" without a request.
 */
export function useDefaultAddress(enabled: boolean): DefaultAddressState {
  const [state, setState] = useState<Omit<DefaultAddressState, 'retry'>>({ ...IDLE, loading: true });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let active = true;

    async function load() {
      setState({ ...IDLE, loading: true });
      try {
        const res = await fetch('/api/user/addresses');
        // Signed-out is two shapes: the route's 401, or the middleware's
        // redirect to the landing page (a followed 307 with an HTML body).
        const isJson = res.headers.get('content-type')?.includes('application/json') ?? false;
        if (res.status === 401 || res.redirected || !isJson) {
          if (active) setState({ ...IDLE });
          return;
        }
        if (!res.ok) throw new Error('Could not load addresses');
        const body = (await res.json()) as { addresses?: UserAddressView[] };
        const list = Array.isArray(body.addresses) ? body.addresses : [];
        const address = list.find((a) => a.isDefault) ?? list[0] ?? null;
        if (active) setState({ loading: false, address, error: false });
      } catch {
        if (active) setState({ loading: false, address: null, error: true });
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [enabled, reloadKey]);

  const retry = () => setReloadKey((k) => k + 1);
  return enabled ? { ...state, retry } : { ...IDLE, retry };
}

interface DeliveryAddressHintProps {
  signedIn: boolean;
  state: DefaultAddressState;
  className?: string;
}

/**
 * The line under the price that says where an order would ship: the
 * default address with a "Change" link, an "Add a delivery address"
 * prompt when there is none, or a sign-in nudge for anonymous visitors.
 * Only rendered when the store is taking orders (not while coming soon).
 */
export function DeliveryAddressHint({ signedIn, state, className = '' }: DeliveryAddressHintProps) {
  // Sign-in returns to this product page, not the booking screen.
  const pathname = usePathname();
  if (!signedIn) {
    return (
      <Link
        href={loginHref(pathname)}
        className={`inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-accent transition-colors ${className}`}
      >
        <MapPin className="w-3.5 h-3.5" />
        Sign in to save a delivery address
      </Link>
    );
  }

  if (state.loading) {
    return (
      <div className={`flex items-center gap-2 text-xs text-slate-500 ${className}`} aria-live="polite">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Loading your delivery address…
      </div>
    );
  }

  if (state.error) {
    return (
      <div className={`flex items-center justify-between gap-2 text-xs text-slate-400 ${className}`}>
        <span>Couldn’t load your addresses.</span>
        <button
          type="button"
          onClick={state.retry}
          className="text-accent font-semibold hover:underline cursor-pointer shrink-0"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!state.address) {
    return (
      <div className={`bg-white/[0.04] rounded-xl border border-white/[0.08] p-3 flex items-center gap-3 ${className}`}>
        <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
          <Truck className="w-4 h-4 text-accent" />
        </div>
        <div className="min-w-0 flex-1">
          <Link href={PROFILE_PATH} className="text-sm font-semibold text-accent hover:underline">
            Add a delivery address
          </Link>
          <p className="text-[11px] text-slate-500 leading-snug">We’ll include it in your WhatsApp order.</p>
        </div>
      </div>
    );
  }

  const { address } = state;
  return (
    <div className={`bg-white/[0.04] rounded-xl border border-white/[0.08] p-3 flex items-start gap-3 ${className}`}>
      <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
        <Truck className="w-4 h-4 text-accent" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Deliver to</p>
        <p className="text-sm font-semibold text-white truncate">{address.fullName}</p>
        <p className="text-xs text-slate-400 leading-snug break-words">{formatAddressSummary(address)}</p>
      </div>
      <Link
        href={PROFILE_PATH}
        className="text-xs font-semibold text-accent hover:underline shrink-0 py-0.5"
      >
        Change
      </Link>
    </div>
  );
}
