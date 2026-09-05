'use client';

import Link from 'next/link';
import { SHOP_PATH, type MarketplaceProductView } from '@/lib/marketplace';
import { ProductImage } from './ProductImage';
import { ComingSoonBadge, FeaturedBadge, PriceTag } from './ShopBadges';

interface ProductCardProps {
  product: MarketplaceProductView;
  /** Store-wide pre-launch state — puts the ribbon on every card. */
  comingSoon: boolean;
  /** Where the tap goes; defaults to the product page. */
  href?: string;
  className?: string;
  priority?: boolean;
}

/**
 * The one product tile — used by the /shop grid and the landing page's
 * featured strip so the two never drift. Portrait 4:5 photo (bats are
 * tall), name, brand, price with MRP strike-through, and the state
 * ribbons: Coming soon (store-wide), Featured, Out of stock.
 */
export function ProductCard({ product, comingSoon, href, className = '', priority }: ProductCardProps) {
  const soldOut = !product.inStock || product.stockQty === 0;
  return (
    <Link
      href={href ?? `${SHOP_PATH}/${product.id}`}
      className={`group relative flex flex-col rounded-xl md:rounded-2xl overflow-hidden border border-white/[0.06] hover:border-accent/25 bg-[#060d1b]/80 transition-all duration-300 hover:shadow-[0_8px_40px_rgba(56,189,248,0.08)] active:scale-[0.99] ${className}`}
    >
      <ProductImage
        image={product.primaryImage}
        category={product.category}
        alt={product.name}
        className="aspect-[4/5] w-full group-hover:[&_img]:scale-105 [&_img]:transition-transform [&_img]:duration-700"
        priority={priority}
      />
      {/* State ribbons over the photo */}
      <div className="absolute top-1.5 left-1.5 md:top-2.5 md:left-2.5 flex flex-col items-start gap-1">
        {comingSoon && <ComingSoonBadge />}
        {product.isFeatured && !comingSoon && <FeaturedBadge />}
      </div>
      {soldOut && (
        <div className="absolute top-1.5 right-1.5 md:top-2.5 md:right-2.5 rounded-full bg-black/60 backdrop-blur-md border border-red-500/30 text-red-300 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider">
          Sold out
        </div>
      )}
      <div className="p-2 md:p-3 flex flex-col gap-0.5 md:gap-1 flex-1">
        <p className="text-[9px] md:text-[10px] font-bold uppercase tracking-wider text-slate-500 truncate">
          {product.brand || product.categoryLabel}
        </p>
        <h3 className="text-xs md:text-sm font-bold text-white leading-snug line-clamp-2 group-hover:text-accent transition-colors">
          {product.name}
        </h3>
        <PriceTag product={product} className="mt-auto pt-1" />
      </div>
    </Link>
  );
}
