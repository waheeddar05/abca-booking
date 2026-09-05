'use client';

/**
 * Client-side read of `GET /api/shop/status` — the store's launch state
 * for the current center — shared by every highlight (Navbar, BottomNav,
 * landing page, the /slots promo strip) through one module-level cache
 * so a page with three highlights makes one request, not three.
 *
 * The cache lives for the page load. Center switches reload the page
 * (see `CenterProvider.switchTo`), which resets it; the admin settings
 * card calls `invalidateMarketplaceStatus()` after a save so the panel's
 * own chrome reflects the change without a reload.
 */

import { useCallback, useEffect, useState } from 'react';
import type { MarketplaceStatus } from '@/lib/marketplace';

let cached: MarketplaceStatus | null = null;
let inflight: Promise<MarketplaceStatus | null> | null = null;
const listeners = new Set<(s: MarketplaceStatus | null) => void>();

async function fetchStatus(): Promise<MarketplaceStatus | null> {
  try {
    const res = await fetch('/api/shop/status');
    const isJson = res.headers.get('content-type')?.includes('application/json') ?? false;
    if (!res.ok || !isJson) return null;
    return (await res.json()) as MarketplaceStatus;
  } catch {
    return null;
  }
}

function load(force = false): Promise<MarketplaceStatus | null> {
  if (cached && !force) return Promise.resolve(cached);
  if (!inflight) {
    inflight = fetchStatus()
      .then((s) => {
        cached = s;
        listeners.forEach((l) => l(s));
        return s;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** Drop the cached status; the next `useMarketplaceStatus` mount refetches. */
export function invalidateMarketplaceStatus(): void {
  cached = null;
}

export interface MarketplaceStatusState {
  /** Null until loaded, or when the request failed. */
  status: MarketplaceStatus | null;
  /** True until the first response (or failure). Gates should wait, not flash. */
  loading: boolean;
  /** Store switched on for this center. Optimistically true while loading. */
  enabled: boolean;
  comingSoon: boolean;
  refresh: () => Promise<void>;
}

export function useMarketplaceStatus(): MarketplaceStatusState {
  const [status, setStatus] = useState<MarketplaceStatus | null>(cached);
  const [loading, setLoading] = useState(cached === null);

  useEffect(() => {
    let active = true;
    const onUpdate = (s: MarketplaceStatus | null) => {
      if (active) setStatus(s);
    };
    listeners.add(onUpdate);
    load().then((s) => {
      if (!active) return;
      setStatus(s);
      setLoading(false);
    });
    return () => {
      active = false;
      listeners.delete(onUpdate);
    };
  }, []);

  const refresh = useCallback(async () => {
    const s = await load(true);
    setStatus(s);
    setLoading(false);
  }, []);

  return {
    status,
    loading,
    // While loading, assume the store exists so the nav doesn't pop a tab
    // in a beat later; a disabled store hides it as soon as we know.
    enabled: status ? status.enabled : true,
    comingSoon: status ? status.comingSoon : true,
    refresh,
  };
}
