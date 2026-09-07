'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { SHOP_PATH, type MarketplaceCategoryId } from '@/lib/marketplace';
import { useMarketplaceStatus } from '@/lib/marketplace-status';
import { CATEGORY_TILES } from './categoryIcons';
import { ProductCard } from './ProductCard';
import { ComingSoonBadge } from './ShopBadges';
import { SHOP_BAND, ShopMediaBand } from './ShopMediaBand';

const DEFAULT_TAGLINE = 'Bats, gloves, thigh guards & more — sold straight from PlayOrbit.';

/** The launch line-up shown until the center publishes its first products. */
const TEASER_CATEGORIES: ReadonlyArray<MarketplaceCategoryId> = ['BAT', 'GLOVES', 'THIGH_GUARD', 'PADS'];

const TEASER_TILES = TEASER_CATEGORIES.flatMap((value) => {
  const tile = CATEGORY_TILES.find((t) => t.value === value);
  return tile ? [tile] : [];
});

/** One accent per tile, matching the multi-colour Ways to Train row above it. */
const TILE_COLORS: Record<string, string> = {
  BAT: 'text-accent',
  GLOVES: 'text-purple-400',
  THIGH_GUARD: 'text-emerald-400',
  PADS: 'text-amber-400',
};

/**
 * The landing page's store section — sits between Ways to Train and the
 * features grid and mirrors their styling. Shows the center's featured
 * products when it has any, otherwise the category teaser, and always a
 * button into /shop.
 *
 * While the status is loading the static teaser renders (no flash of an
 * empty band); a center with the store switched off renders nothing.
 */
export function LandingShopSection() {
  const { status, loading, enabled, comingSoon } = useMarketplaceStatus();

  if (!loading && !enabled) return null;

  // Only mark "coming soon" once we know — the optimistic default would
  // flash the badge on a live store for a beat and then pull it.
  const showComingSoon = !loading && comingSoon;
  const featured = status?.featured ?? [];
  const productCount = status?.productCount ?? 0;
  const tagline = (status?.launchNote ?? '').trim() || DEFAULT_TAGLINE;

  return (
    <section id="shop" className="relative z-10 px-4 md:px-6 py-4 md:py-10">
      <div className="max-w-6xl mx-auto">
        <div className="text-center max-w-2xl mx-auto mb-3 md:mb-8">
          <div className="flex flex-col md:flex-row items-center justify-center gap-1.5 md:gap-3 mb-1 md:mb-2">
            <h3 className="text-lg md:text-3xl font-black text-white leading-tight">
              GEAR <span className="text-accent/40">UP.</span>
            </h3>
            {showComingSoon && <ComingSoonBadge size="lg" />}
          </div>
          <p className="text-slate-500 text-[10px] md:text-sm">{tagline}</p>
        </div>

        {SHOP_BAND && <ShopMediaBand {...SHOP_BAND} />}

        {featured.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
            {featured.map((product) => (
              <ProductCard key={product.id} product={product} comingSoon={showComingSoon} />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5 md:gap-4">
            {TEASER_TILES.map((tile) => (
              <div
                key={tile.value}
                className="group p-2.5 md:p-5 rounded-lg md:rounded-2xl border border-white/[0.05] hover:border-white/[0.1] bg-[#060d1b]/60 hover:bg-[#0a1628]/80 transition-all duration-300 text-center min-w-0"
              >
                <div
                  className={`w-8 h-8 md:w-11 md:h-11 rounded-lg md:rounded-xl bg-white/[0.04] flex items-center justify-center mb-1.5 md:mb-3 border border-white/[0.06] mx-auto ${TILE_COLORS[tile.value] ?? 'text-accent'} group-hover:scale-110 transition-transform`}
                >
                  <tile.icon className="w-4 h-4 md:w-5 md:h-5" />
                </div>
                <h4 className="text-[11px] md:text-base font-black text-white mb-0.5 md:mb-1.5 uppercase italic tracking-tighter leading-tight">
                  {tile.label}
                </h4>
                <p className="text-slate-500 text-[9px] md:text-xs leading-relaxed group-hover:text-slate-400 transition-colors">
                  {tile.blurb}
                </p>
              </div>
            ))}
          </div>
        )}

        <div className="mt-3 md:mt-6 flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-4">
          <Link
            href={SHOP_PATH}
            className="inline-flex items-center justify-center gap-2 bg-accent hover:bg-accent-light text-primary font-bold rounded-xl px-5 py-2.5 text-xs md:text-sm transition-all active:scale-[0.98]"
          >
            EXPLORE THE STORE
            <ArrowRight className="w-4 h-4" />
          </Link>
          {productCount > 0 && (
            <p className="text-slate-500 text-[10px] md:text-xs">
              {productCount} {productCount === 1 ? 'product' : 'products'}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
