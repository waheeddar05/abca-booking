'use client';

import Link from 'next/link';
import { useSyncExternalStore } from 'react';
import { ArrowRight, ShoppingBag, X } from 'lucide-react';
import { SHOP_PATH } from '@/lib/marketplace';
import { useMarketplaceStatus } from '@/lib/marketplace-status';
import { ComingSoonBadge } from './ShopBadges';

/**
 * Slim, dismissible "there's a shop" strip for the booking screen — the
 * page every signed-in user lands on, so the one place a store highlight
 * is guaranteed to be seen.
 *
 * Follows `MultiCenterBanner`: the dismissal lives in localStorage behind
 * a tiny external store read through `useSyncExternalStore`, which needs
 * no mount effect or setState. Hidden while the status loads, when the
 * center has the store switched off, and once dismissed.
 */

const DISMISS_KEY = 'po_shop_promo_dismissed_v1';

// The native `storage` event only fires in *other* tabs, so same-tab
// updates go through this listener set.
const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === DISMISS_KEY) cb();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', onStorage);
  };
}

function getDismissedSnapshot(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    // Private mode / storage disabled — treat as not dismissed so it shows.
    return false;
  }
}

// On the server (and during hydration) act dismissed so nothing renders
// until the client takes over — the status is client-loaded anyway.
function getServerSnapshot(): boolean {
  return true;
}

function dismiss(): void {
  try {
    localStorage.setItem(DISMISS_KEY, '1');
  } catch {
    // Non-fatal — still hide it for this tab via the listener notify below.
  }
  listeners.forEach((l) => l());
}

export function MarketplacePromoBanner() {
  const dismissed = useSyncExternalStore(subscribe, getDismissedSnapshot, getServerSnapshot);
  const { loading, enabled, comingSoon } = useMarketplaceStatus();

  if (dismissed || loading || !enabled) return null;

  return (
    <div
      className={`relative z-10 mb-4 rounded-xl border px-3 py-2 text-xs animate-fade-in ${
        comingSoon ? 'bg-amber-500/10 border-amber-500/20' : 'bg-accent/10 border-accent/20'
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <ShoppingBag className={`w-4 h-4 flex-shrink-0 ${comingSoon ? 'text-amber-300' : 'text-accent'}`} />
        {/* Wraps onto a second line on narrow phones instead of truncating. */}
        <div className="flex-1 min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-slate-300 leading-snug">
            <span className="font-semibold text-white">PlayOrbit Shop</span> — bats, gloves &amp; gear.
          </span>
          {comingSoon ? (
            <ComingSoonBadge />
          ) : (
            <span className="inline-flex items-center rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider">
              Now open
            </span>
          )}
        </div>
        <Link
          href={SHOP_PATH}
          className={`flex items-center gap-1 font-semibold flex-shrink-0 whitespace-nowrap transition-colors ${
            comingSoon ? 'text-amber-300 hover:text-amber-200' : 'text-accent hover:text-accent-light'
          }`}
        >
          Explore
          <ArrowRight className="w-3 h-3" />
        </Link>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss shop promotion"
          className="flex-shrink-0 text-slate-500 hover:text-white transition-colors p-0.5 cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
