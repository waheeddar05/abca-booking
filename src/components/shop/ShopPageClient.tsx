'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, MapPin, MessageCircle, Search, SearchX, ShoppingBag, Store, X } from 'lucide-react';
import {
  SHOP_PATH,
  STORE_NAME,
  buildWhatsAppLink,
  isMarketplaceCategory,
  type MarketplaceCategoryCount,
  type MarketplaceProductView,
} from '@/lib/marketplace';
import { PageBackground } from '@/components/ui/PageBackground';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ProductCard } from './ProductCard';
import { ComingSoonBadge } from './ShopBadges';
import { CategoryChips } from './CategoryChips';
import { ShopTeaser } from './ShopTeaser';

/** `GET /api/shop/products` */
interface ShopCatalogResponse {
  config: { enabled: boolean; comingSoon: boolean; launchNote: string; pickupNote: string };
  enquiryPhone: string | null;
  products: MarketplaceProductView[];
  categories: MarketplaceCategoryCount[];
  /** Count for the active filter — what the grid can grow to via Load more. */
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_MAX_LENGTH = 60;
const PAGE_LIMIT = 24;
const QUESTION_ENQUIRY = 'Hi PlayOrbit, I have a question about your store.';

/**
 * Replace the URL's `?category=` / `?q=` in place. Reads the live
 * `window.location` rather than a captured `searchParams` so a debounced
 * search commit can't clobber a category change made during the delay.
 */
function buildShopUrl(patch: { category?: string; q?: string }): string {
  const params = new URLSearchParams(window.location.search);
  if (patch.category !== undefined) {
    if (patch.category) params.set('category', patch.category);
    else params.delete('category');
  }
  if (patch.q !== undefined) {
    if (patch.q) params.set('q', patch.q);
    else params.delete('q');
  }
  const qs = params.toString();
  return qs ? `${SHOP_PATH}?${qs}` : SHOP_PATH;
}

/**
 * The /shop storefront. The URL is the source of truth for the filter
 * (`?category=`) and the search (`?q=`) so a filtered view can be shared
 * and survives a reload; the search box debounces into it.
 */
export function ShopPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const rawCategory = searchParams.get('category') ?? '';
  // An unknown code would make the API answer 400; treat it as "All".
  const category = isMarketplaceCategory(rawCategory) ? rawCategory : '';
  const q = (searchParams.get('q') ?? '').trim().slice(0, SEARCH_MAX_LENGTH);

  const [data, setData] = useState<ShopCatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  // The search box is local state that commits to the URL after a pause.
  // The URL can also change underneath it (browser back/forward, the nav's
  // own Shop link), so the box mirrors `q` whenever the URL moves — except
  // while the user is mid-word: from the first keystroke until the debounce
  // commits, nothing may overwrite what they have typed.
  const [searchInput, setSearchInput] = useState(q);
  const [typing, setTyping] = useState(false);
  const [seenQ, setSeenQ] = useState(q);
  if (q !== seenQ) {
    setSeenQ(q);
    if (!typing) setSearchInput(q);
  }
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    async function load() {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams();
        if (category) params.set('category', category);
        if (q) params.set('q', q);
        params.set('limit', String(PAGE_LIMIT));
        const res = await fetch(`/api/shop/products?${params.toString()}`, {
          signal: controller.signal,
        });
        const isJson = res.headers.get('content-type')?.includes('application/json') ?? false;
        const body: unknown = isJson ? await res.json() : null;
        if (!res.ok) {
          const message =
            body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
              ? (body as { error: string }).error
              : 'Could not load the shop';
          throw new Error(message);
        }
        if (!active) return;
        setData(body as ShopCatalogResponse);
      } catch (err) {
        if (!active || controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Could not load the shop');
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [category, q, reloadKey]);

  // Drop a pending search commit if the page unmounts mid-pause.
  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    };
  }, []);

  // The commit owns the box: whatever lands in the URL is what the input
  // shows, so the clear button empties it and back/forward re-syncs it.
  const commitSearch = (value: string) => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const next = value.trim().slice(0, SEARCH_MAX_LENGTH);
    setTyping(false);
    setSearchInput(next);
    router.replace(buildShopUrl({ q: next }), { scroll: false });
  };

  const handleSearchChange = (value: string) => {
    setSearchInput(value);
    setTyping(true);
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      commitSearch(value);
    }, SEARCH_DEBOUNCE_MS);
  };

  const selectCategory = (value: string) => {
    router.replace(buildShopUrl({ category: value }), { scroll: false });
  };

  const clearFilters = () => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    setTyping(false);
    setSearchInput('');
    router.replace(SHOP_PATH, { scroll: false });
  };

  const retry = () => setReloadKey((k) => k + 1);

  // Next page of the same filter, appended. The route pages by offset, so
  // the offset is simply how many rows the grid already shows.
  const loadMore = async () => {
    if (!data || !data.hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams();
      if (category) params.set('category', category);
      if (q) params.set('q', q);
      params.set('limit', String(PAGE_LIMIT));
      params.set('offset', String(data.products.length));
      const res = await fetch(`/api/shop/products?${params.toString()}`);
      const isJson = res.headers.get('content-type')?.includes('application/json') ?? false;
      const body: unknown = isJson ? await res.json() : null;
      if (!res.ok) {
        const message =
          body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
            ? (body as { error: string }).error
            : 'Could not load more products';
        throw new Error(message);
      }
      const page = body as ShopCatalogResponse;
      setData((prev) => {
        if (!prev) return page;
        // Drop anything already shown — a product published between the
        // two requests shifts the offsets by one.
        const seen = new Set(prev.products.map((p) => p.id));
        const fresh = page.products.filter((p) => !seen.has(p.id));
        return { ...page, products: [...prev.products, ...fresh] };
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load more products');
    } finally {
      setLoadingMore(false);
    }
  };

  const config = data?.config ?? null;
  const enabled = config ? config.enabled : true;
  const comingSoon = config ? config.comingSoon : false;
  const hasFilter = category !== '' || q !== '';
  const initialLoading = loading && data === null;
  const refetching = loading && data !== null;
  const questionLink = buildWhatsAppLink(data?.enquiryPhone, QUESTION_ENQUIRY);

  return (
    <div className="max-w-2xl mx-auto px-4 py-5">
      <PageBackground />

      {/* Header */}
      <header className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
          <ShoppingBag className="w-5 h-5 text-accent" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-white leading-tight">{STORE_NAME}</h1>
            {comingSoon && <ComingSoonBadge size="lg" />}
          </div>
          {config?.launchNote && (
            <p className="text-xs text-amber-300/90 mt-1 leading-snug break-words">{config.launchNote}</p>
          )}
          {config?.pickupNote && (
            <p className="text-[11px] text-slate-500 mt-1 flex items-start gap-1 leading-snug">
              <MapPin className="w-3 h-3 mt-px shrink-0 text-accent/70" aria-hidden="true" />
              {config.pickupNote}
            </p>
          )}
        </div>
      </header>

      {error ? (
        <ErrorState message={error} onRetry={retry} />
      ) : initialLoading ? (
        <>
          <SearchBox value={searchInput} onChange={handleSearchChange} onSubmit={commitSearch} busy />
          <ProductGridSkeleton />
        </>
      ) : !enabled ? (
        <EmptyState
          icon={Store}
          title="The store is closed right now"
          description="Check back soon — we’ll reopen with fresh gear."
        />
      ) : data && data.products.length === 0 && !hasFilter ? (
        <ShopTeaser enquiryPhone={data.enquiryPhone} pickupNote={config?.pickupNote ?? ''} />
      ) : data ? (
        <>
          <SearchBox
            value={searchInput}
            onChange={handleSearchChange}
            onSubmit={commitSearch}
            busy={refetching}
          />
          <CategoryChips
            categories={data.categories}
            selected={category}
            onSelect={selectCategory}
            className="mb-4"
          />

          {data.products.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title="No products match"
              description={
                q
                  ? `Nothing found for “${q}”${category ? ' in this category' : ''}.`
                  : 'Nothing in this category right now.'
              }
              action={{ label: 'Clear filters', onClick: clearFilters }}
            />
          ) : (
            <>
              <div
                className={`grid grid-cols-2 md:grid-cols-3 gap-2.5 transition-opacity duration-200 ${
                  refetching ? 'opacity-60' : 'opacity-100'
                }`}
                aria-busy={refetching}
              >
                {data.products.map((product, i) => (
                  <ProductCard key={product.id} product={product} comingSoon={comingSoon} priority={i < 4} />
                ))}
              </div>
              {data.hasMore && (
                <div className="mt-4 flex flex-col items-center gap-1.5">
                  <button
                    type="button"
                    onClick={loadMore}
                    disabled={loadingMore || refetching}
                    className="inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold bg-white/[0.06] hover:bg-white/[0.1] text-slate-200 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
                  >
                    {loadingMore && <Loader2 className="w-4 h-4 animate-spin" />}
                    {loadingMore ? 'Loading…' : 'Load more'}
                  </button>
                  <p className="text-[11px] text-slate-500 tabular-nums">
                    Showing {data.products.length} of {data.total}
                  </p>
                </div>
              )}
            </>
          )}

          {questionLink && (
            <p className="mt-8 text-center text-xs text-slate-500">
              Questions?{' '}
              <a
                href={questionLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-accent font-semibold hover:underline"
              >
                <MessageCircle className="w-3.5 h-3.5" />
                Ask us on WhatsApp
              </a>
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}

function SearchBox({
  value,
  onChange,
  onSubmit,
  busy,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  busy: boolean;
}) {
  return (
    <div className="relative mb-3">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
      <input
        type="text"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        maxLength={SEARCH_MAX_LENGTH}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onSubmit(value);
          }
        }}
        placeholder="Search bats, gloves, brands…"
        aria-label="Search products"
        className="w-full bg-slate-900/60 border border-white/[0.1] text-white rounded-lg pl-9 pr-9 py-2 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 [color-scheme:dark] placeholder:text-slate-500"
      />
      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center">
        {busy ? (
          <Loader2 className="w-4 h-4 animate-spin text-slate-500" aria-label="Searching" />
        ) : value ? (
          <button
            type="button"
            onClick={() => onSubmit('')}
            aria-label="Clear search"
            className="p-1 rounded-md text-slate-500 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ProductGridSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl md:rounded-2xl overflow-hidden border border-white/[0.06] bg-[#060d1b]/80 animate-pulse"
        >
          <div className="aspect-[4/5] bg-white/[0.05]" />
          <div className="p-2 md:p-3 space-y-2">
            <div className="h-2.5 w-1/3 bg-white/[0.08] rounded" />
            <div className="h-3.5 w-5/6 bg-white/10 rounded" />
            <div className="h-4 w-1/2 bg-white/10 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}
