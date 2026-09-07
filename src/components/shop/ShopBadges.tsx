'use client';

import { Clock, Star } from 'lucide-react';
import { formatRupees, stockLabel, type MarketplaceProductView } from '@/lib/marketplace';

/**
 * The store-wide pre-launch marker. `size="lg"` for page headers, where it
 * sits on the dark page background; the small one is a ribbon over a
 * product photo, so it gets an opaque dark backdrop — the translucent amber
 * alone was unreadable across pale willow and wood.
 */
export function ComingSoonBadge({ size = 'sm', className = '' }: { size?: 'sm' | 'lg'; className?: string }) {
  const lg = size === 'lg';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border text-amber-300 font-bold uppercase tracking-wider ${
        lg
          ? 'bg-amber-500/15 border-amber-500/30 px-3 py-1 text-[11px] md:text-xs'
          : 'bg-[#030712]/85 backdrop-blur-md border-amber-500/40 px-2 py-0.5 text-[9px] shadow-[0_2px_8px_rgba(0,0,0,0.6)]'
      } ${className}`}
    >
      <Clock className={lg ? 'w-3.5 h-3.5' : 'w-2.5 h-2.5'} />
      Coming soon
    </span>
  );
}

/** Ribbon over a product photo once the store is open — same opaque backdrop as the small Coming soon. */
export function FeaturedBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-[#030712]/85 backdrop-blur-md border border-accent/40 text-accent px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider shadow-[0_2px_8px_rgba(0,0,0,0.6)] ${className}`}
    >
      <Star className="w-2.5 h-2.5 fill-current" />
      Featured
    </span>
  );
}

/** Selling price with the MRP struck through and the saving, when there is one. */
export function PriceTag({
  product,
  size = 'sm',
  className = '',
}: {
  product: Pick<MarketplaceProductView, 'price' | 'mrp' | 'discountPercent'>;
  size?: 'sm' | 'lg';
  className?: string;
}) {
  const lg = size === 'lg';
  return (
    <div className={`flex items-baseline gap-1.5 flex-wrap ${className}`}>
      <span className={`font-black text-white tabular-nums ${lg ? 'text-2xl' : 'text-sm md:text-base'}`}>
        {formatRupees(product.price)}
      </span>
      {product.mrp != null && product.mrp > product.price && (
        <>
          <span className={`text-slate-500 line-through tabular-nums ${lg ? 'text-sm' : 'text-[11px]'}`}>
            {formatRupees(product.mrp)}
          </span>
          {product.discountPercent != null && (
            <span className={`text-emerald-400 font-bold ${lg ? 'text-sm' : 'text-[10px]'}`}>
              {product.discountPercent}% off
            </span>
          )}
        </>
      )}
    </div>
  );
}

/** "In stock" / "Only 2 left" / "Out of stock" pill. */
export function StockPill({
  product,
  className = '',
}: {
  product: Pick<MarketplaceProductView, 'inStock' | 'stockQty'>;
  className?: string;
}) {
  const { text, tone } = stockLabel(product);
  const tones = {
    ok: 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400',
    low: 'bg-amber-500/10 border-amber-500/25 text-amber-300',
    out: 'bg-red-500/10 border-red-500/25 text-red-400',
  } as const;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${tones[tone]} ${className}`}
    >
      {text}
    </span>
  );
}
