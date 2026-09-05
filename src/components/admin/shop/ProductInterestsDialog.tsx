'use client';

/**
 * Who tapped "Notify me when available" on a product — the launch-demand
 * list. Read-only: name, number as a tap-to-call link, and when. The
 * count on the list row is what opens this.
 */

import { useCallback, useEffect, useState } from 'react';
import { Heart, Phone } from 'lucide-react';
import { ErrorState } from '@/components/ui/ErrorState';
import { LoadingState } from '@/components/ui/LoadingState';
import type { MarketplaceInterestView, MarketplaceProductAdminView } from '@/lib/marketplace';
import { formatDateTime, readApiError, secondaryButtonClass } from './common';
import { ShopDialog } from './ShopDialog';
import type { ProductDetailResponse } from './types';

interface Props {
  product: MarketplaceProductAdminView;
  onClose: () => void;
}

export function ProductInterestsDialog({ product, onClose }: Props) {
  const [interests, setInterests] = useState<MarketplaceInterestView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      setError(null);
      setInterests(null);
      try {
        const res = await fetch(`/api/admin/shop/products/${product.id}`, { signal: controller.signal });
        if (!res.ok) throw new Error(await readApiError(res, "Couldn't load the interest list"));
        const json = (await res.json()) as ProductDetailResponse;
        setInterests(json.interests);
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : "Couldn't load the interest list");
      }
    })();
    return () => controller.abort();
  }, [product.id, reloadKey]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  return (
    <ShopDialog
      title="Interested customers"
      subtitle={product.name}
      onClose={onClose}
      footer={
        <>
          {interests && interests.length > 0 && (
            <span className="mr-auto text-xs text-slate-500">
              {interests.length} {interests.length === 1 ? 'person' : 'people'}
            </span>
          )}
          <button type="button" onClick={onClose} className={secondaryButtonClass}>
            Close
          </button>
        </>
      }
    >
      {error ? (
        <ErrorState message={error} onRetry={retry} className="py-8" />
      ) : interests === null ? (
        <LoadingState size="sm" message="Loading…" />
      ) : interests.length === 0 ? (
        <div className="text-center py-8">
          <div className="w-12 h-12 rounded-2xl bg-white/[0.04] flex items-center justify-center mx-auto mb-3">
            <Heart className="w-5 h-5 text-slate-500" />
          </div>
          <p className="text-sm font-medium text-slate-300">Nobody has asked to be notified yet</p>
          <p className="text-xs text-slate-500 mt-1">
            Customers tap &ldquo;Notify me&rdquo; on the product page while the store is in Coming soon mode.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-white/[0.05] -mx-1">
          {interests.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-3 px-1 py-2.5">
              <div className="min-w-0">
                <p className={`text-sm truncate ${i.name ? 'text-white font-medium' : 'text-slate-500 italic'}`}>
                  {i.name || 'No name'}
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">{formatDateTime(i.createdAt)}</p>
              </div>
              {i.mobileNumber ? (
                <a
                  href={`tel:${i.mobileNumber}`}
                  className="inline-flex items-center gap-1.5 shrink-0 rounded-lg bg-accent/10 border border-accent/20 text-accent px-2.5 py-1.5 text-xs font-semibold tabular-nums hover:bg-accent/15 transition-colors"
                >
                  <Phone className="w-3.5 h-3.5" />
                  {i.mobileNumber}
                </a>
              ) : (
                <span className="text-xs text-slate-600 shrink-0">No number</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </ShopDialog>
  );
}
