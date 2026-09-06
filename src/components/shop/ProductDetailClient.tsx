'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, Copy, MapPin, MessageCircle, Minus, PackageSearch, Plus } from 'lucide-react';
import { useCurrentUser } from '@/lib/current-user';
import { useToast } from '@/components/ui/Toast';
import { PageBackground } from '@/components/ui/PageBackground';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import {
  SHOP_PATH,
  buildEnquiryMessage,
  buildWhatsAppLink,
  formatRupees,
  type MarketplaceProductView,
} from '@/lib/marketplace';
import { formatAddressLines } from '@/lib/addresses';
import { ProductGallery } from './ProductGallery';
import { ComingSoonBadge, PriceTag, StockPill } from './ShopBadges';
import { NotifyMeButton } from './NotifyMeButton';
import { DeliveryAddressHint, useDefaultAddress } from './DeliveryAddressHint';

/** `GET /api/shop/products/[id]` */
interface ProductDetailResponse {
  product: MarketplaceProductView;
  config: { enabled: boolean; comingSoon: boolean; launchNote: string; pickupNote: string };
  enquiryPhone: string | null;
  interested: boolean;
  signedIn: boolean;
}

const MIN_QTY = 1;
const MAX_QTY = 10;

// The page's absolute origin, for the link pasted into WhatsApp. Read
// through useSyncExternalStore so the server render (no window) gets ''
// and the client fills it in after hydration without an effect.
const subscribeNoop = () => () => {};
const getOrigin = () => window.location.origin;
const getServerOrigin = () => '';

interface ProductDetailClientProps {
  id: string;
}

/**
 * /shop/[id]. Everything that depends on who is looking — "Notify me",
 * the delivery address, the sign-in nudges — keys off the API's
 * `signedIn`, so an anonymous visitor gets the full page with the right
 * calls to action rather than a login wall.
 */
export function ProductDetailClient({ id }: ProductDetailClientProps) {
  const router = useRouter();
  const toast = useToast();
  // The mobile bottom nav renders only for a signed-in user (it reads the
  // same hook), so the sticky bar's offset follows it, not the API flag.
  const { user: navUser } = useCurrentUser();

  const [data, setData] = useState<ProductDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [interested, setInterested] = useState(false);
  const [size, setSize] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(MIN_QTY);
  const [copied, setCopied] = useState(false);

  const origin = useSyncExternalStore(subscribeNoop, getOrigin, getServerOrigin);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    async function load() {
      setLoading(true);
      setError('');
      setNotFound(false);
      try {
        const res = await fetch(`/api/shop/products/${encodeURIComponent(id)}`, {
          signal: controller.signal,
        });
        if (res.status === 404) {
          if (active) setNotFound(true);
          return;
        }
        const isJson = res.headers.get('content-type')?.includes('application/json') ?? false;
        const body: unknown = isJson ? await res.json() : null;
        if (!res.ok) {
          const message =
            body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
              ? (body as { error: string }).error
              : 'Could not load this product';
          throw new Error(message);
        }
        if (!active) return;
        const detail = body as ProductDetailResponse;
        setData(detail);
        setInterested(detail.interested);
      } catch (err) {
        if (!active || controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Could not load this product');
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [id, reloadKey]);

  const comingSoon = data?.config.comingSoon ?? true;
  const signedIn = data?.signedIn ?? false;
  const addressState = useDefaultAddress(Boolean(data) && signedIn && !comingSoon);

  const retry = () => setReloadKey((k) => k + 1);

  const productUrl = data && origin ? `${origin}${SHOP_PATH}/${encodeURIComponent(data.product.id)}` : null;

  const copyLink = async () => {
    if (!productUrl) return;
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      toast.error('Copying isn’t available here', 'Long-press the address bar to copy the link instead.');
      return;
    }
    try {
      await navigator.clipboard.writeText(productUrl);
      setCopied(true);
      toast.success('Link copied', 'Share it with a friend or on WhatsApp.');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Couldn’t copy the link', 'Long-press the address bar to copy it instead.');
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-5">
      <PageBackground />

      <Link
        href={SHOP_PATH}
        className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors mb-3"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back to shop
      </Link>

      {error ? (
        <ErrorState message={error} onRetry={retry} />
      ) : loading ? (
        <ProductDetailSkeleton />
      ) : notFound ? (
        <EmptyState
          icon={PackageSearch}
          title="This product isn’t available"
          description="It may have sold out, been removed, or isn’t published yet."
          action={{ label: 'Back to shop', onClick: () => router.push(SHOP_PATH) }}
        />
      ) : data ? (
        <ProductDetail
          data={data}
          interested={interested}
          onInterestedChange={setInterested}
          size={size}
          onSizeChange={setSize}
          quantity={quantity}
          onQuantityChange={setQuantity}
          productUrl={productUrl}
          copied={copied}
          onCopyLink={copyLink}
          addressState={addressState}
          hasBottomNav={Boolean(navUser)}
        />
      ) : null}
    </div>
  );
}

// ─── Loaded view ─────────────────────────────────────────────────────

interface ProductDetailProps {
  data: ProductDetailResponse;
  interested: boolean;
  onInterestedChange: (next: boolean) => void;
  size: string | null;
  onSizeChange: (next: string | null) => void;
  quantity: number;
  onQuantityChange: (next: number) => void;
  productUrl: string | null;
  copied: boolean;
  onCopyLink: () => void;
  addressState: ReturnType<typeof useDefaultAddress>;
  hasBottomNav: boolean;
}

function ProductDetail({
  data,
  interested,
  onInterestedChange,
  size,
  onSizeChange,
  quantity,
  onQuantityChange,
  productUrl,
  copied,
  onCopyLink,
  addressState,
  hasBottomNav,
}: ProductDetailProps) {
  const { product, config, enquiryPhone, signedIn } = data;
  const comingSoon = config.comingSoon;
  const soldOut = !product.inStock || product.stockQty === 0;

  // "Ask" is the interested-wording message: used while coming soon, and
  // for a sold-out product where an order can't be placed.
  const askLink = buildWhatsAppLink(
    enquiryPhone,
    buildEnquiryMessage({ product, size, comingSoon: true, productUrl }),
  );
  const orderLink =
    !comingSoon && !soldOut
      ? buildWhatsAppLink(
          enquiryPhone,
          buildEnquiryMessage({
            product,
            size,
            quantity,
            addressLines: addressState.address ? formatAddressLines(addressState.address) : null,
            productUrl,
            comingSoon: false,
          }),
        )
      : null;

  const metaLine = product.brand ? `${product.brand} · ${product.categoryLabel}` : product.categoryLabel;

  return (
    <article className="md:grid md:grid-cols-2 md:gap-6 md:items-start animate-fade-in">
      <ProductGallery images={product.images} category={product.category} name={product.name} />

      <div className="mt-4 md:mt-0 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 truncate min-w-0">
            {metaLine}
          </p>
          <button
            type="button"
            onClick={onCopyLink}
            disabled={!productUrl}
            aria-label="Copy link to this product"
            className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400 hover:text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>

        <h1 className="text-xl font-black text-white leading-snug mt-1 break-words">{product.name}</h1>

        {comingSoon && (
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <ComingSoonBadge size="lg" />
            {config.launchNote && <span className="text-xs text-amber-300/90">{config.launchNote}</span>}
          </div>
        )}

        <PriceTag product={product} size="lg" className="mt-3" />
        {!comingSoon && <StockPill product={product} className="mt-2" />}

        {config.pickupNote && (
          <p className="mt-3 flex items-start gap-1.5 text-xs text-slate-400 leading-snug">
            <MapPin className="w-3.5 h-3.5 mt-px shrink-0 text-accent/70" aria-hidden="true" />
            {config.pickupNote}
          </p>
        )}

        {product.sizes.length > 0 && (
          <div className="mt-4">
            <p className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Size</p>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Size">
              {product.sizes.map((s) => {
                const active = size === s;
                return (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onSizeChange(active ? null : s)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer active:scale-[0.98] ${
                      active
                        ? 'bg-accent/15 border-accent/40 text-accent'
                        : 'bg-white/[0.04] border-white/[0.08] text-slate-300 hover:bg-white/[0.08] hover:text-white'
                    }`}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {product.description && (
          <div className="mt-4">
            <p className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">About</p>
            <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-line break-words">
              {product.description}
            </p>
          </div>
        )}

        {product.specs.length > 0 && (
          <div className="mt-4">
            <p className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
              Specifications
            </p>
            <dl className="rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden divide-y divide-white/[0.06]">
              {product.specs.map((spec, i) => (
                <div
                  key={`${spec.label}-${i}`}
                  className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3 px-3 py-2 text-xs"
                >
                  <dt className="text-slate-400 break-words">{spec.label}</dt>
                  <dd className="text-white font-medium break-words">{spec.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {!comingSoon && <DeliveryAddressHint signedIn={signedIn} state={addressState} className="mt-4" />}

        {/* Call to action — pinned above the bottom nav on phones, inline on desktop. */}
        <div
          className={`sticky md:static z-30 -mx-4 md:mx-0 mt-5 bg-[#0f1d2f]/95 backdrop-blur-md border-t md:border border-white/[0.08] md:rounded-2xl ${
            hasBottomNav ? 'bottom-[calc(60px_+_env(safe-area-inset-bottom))]' : 'bottom-0 safe-bottom'
          }`}
        >
          <div className="px-4 py-3">
            {comingSoon ? (
              <div className="flex flex-col sm:flex-row gap-2">
                <NotifyMeButton
                  productId={product.id}
                  interested={interested}
                  signedIn={signedIn}
                  onChange={onInterestedChange}
                  className="flex-1"
                />
                {askLink && <WhatsAppLink href={askLink} label="Ask on WhatsApp" variant="secondary" />}
              </div>
            ) : soldOut ? (
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  disabled
                  className="flex-1 inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-bold bg-white/[0.06] text-slate-500 cursor-not-allowed"
                >
                  Sold out
                </button>
                {askLink && <WhatsAppLink href={askLink} label="Ask on WhatsApp" variant="secondary" />}
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3 mb-2 text-xs">
                  <span className="text-slate-400 tabular-nums">
                    {quantity} × {formatRupees(product.price)}
                  </span>
                  <span className="font-bold text-white tabular-nums">{formatRupees(product.price * quantity)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <QuantityStepper value={quantity} onChange={onQuantityChange} />
                  {orderLink ? (
                    <WhatsAppLink href={orderLink} label="Order on WhatsApp" variant="primary" />
                  ) : (
                    <button
                      type="button"
                      disabled
                      className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold bg-accent text-primary opacity-50 cursor-not-allowed"
                    >
                      <MessageCircle className="w-4 h-4" />
                      Order on WhatsApp
                    </button>
                  )}
                </div>
                {!orderLink && (
                  <p className="text-[11px] text-slate-500 mt-2">
                    Ordering isn’t open yet — the store hasn’t set a WhatsApp number.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

// ─── Small pieces ────────────────────────────────────────────────────

function WhatsAppLink({
  href,
  label,
  variant,
}: {
  href: string;
  label: string;
  variant: 'primary' | 'secondary';
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-colors active:scale-[0.98] ${
        variant === 'primary'
          ? 'bg-accent hover:bg-accent-light text-primary'
          : 'bg-white/[0.06] hover:bg-white/[0.1] text-slate-300'
      }`}
    >
      <MessageCircle className="w-4 h-4" />
      {label}
    </a>
  );
}

function QuantityStepper({ value, onChange }: { value: number; onChange: (next: number) => void }) {
  return (
    <div
      className="inline-flex items-center rounded-xl border border-white/[0.1] bg-slate-900/60 overflow-hidden shrink-0"
      role="group"
      aria-label="Quantity"
    >
      <button
        type="button"
        onClick={() => onChange(Math.max(MIN_QTY, value - 1))}
        disabled={value <= MIN_QTY}
        aria-label="Decrease quantity"
        className="w-9 h-10 flex items-center justify-center text-slate-300 hover:bg-white/[0.06] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Minus className="w-4 h-4" />
      </button>
      <span className="w-8 text-center text-sm font-bold text-white tabular-nums" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        onClick={() => onChange(Math.min(MAX_QTY, value + 1))}
        disabled={value >= MAX_QTY}
        aria-label="Increase quantity"
        className="w-9 h-10 flex items-center justify-center text-slate-300 hover:bg-white/[0.06] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Plus className="w-4 h-4" />
      </button>
    </div>
  );
}

function ProductDetailSkeleton() {
  return (
    <div className="md:grid md:grid-cols-2 md:gap-6 animate-pulse" aria-hidden="true">
      <div className="aspect-[4/5] max-h-[70vh] w-full rounded-2xl bg-white/[0.05] border border-white/[0.06]" />
      <div className="mt-4 md:mt-0 space-y-3">
        <div className="h-2.5 w-1/3 bg-white/[0.08] rounded" />
        <div className="h-6 w-4/5 bg-white/10 rounded" />
        <div className="h-7 w-1/3 bg-white/10 rounded" />
        <div className="h-4 w-20 bg-white/[0.08] rounded-full" />
        <div className="space-y-2 pt-2">
          <div className="h-3 w-full bg-white/[0.06] rounded" />
          <div className="h-3 w-11/12 bg-white/[0.06] rounded" />
          <div className="h-3 w-3/4 bg-white/[0.06] rounded" />
        </div>
        <div className="h-11 w-full bg-white/[0.08] rounded-xl mt-4" />
      </div>
    </div>
  );
}
