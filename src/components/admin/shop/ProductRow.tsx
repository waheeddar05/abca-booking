'use client';

/**
 * One product on Admin → Marketplace: a stacked card that fits a phone.
 * Thumbnail, name, brand · category, price, state chips, then a row of
 * compact actions (icon on every width, text from md up).
 */

import { Eye, EyeOff, Heart, Images, Loader2, Pencil, Star, StarOff, Trash2 } from 'lucide-react';
import { ProductImage } from '@/components/shop/ProductImage';
import { FeaturedBadge, PriceTag, StockPill } from '@/components/shop/ShopBadges';
import { stockLabel, type MarketplaceProductAdminView } from '@/lib/marketplace';
import { rowActionClass } from './common';

interface Props {
  product: MarketplaceProductAdminView;
  /** A publish / feature / delete request for this row is in flight. */
  busy: boolean;
  onEdit: () => void;
  onPhotos: () => void;
  onTogglePublished: () => void;
  onToggleFeatured: () => void;
  onDelete: () => void;
  onShowInterests: () => void;
}

const neutralAction = `${rowActionClass} bg-white/[0.04] border-white/[0.08] text-slate-300 hover:text-white hover:bg-white/[0.08]`;
const dangerAction = `${rowActionClass} bg-red-500/[0.06] border-red-500/20 text-red-300 hover:bg-red-500/15`;

export function ProductRow({
  product,
  busy,
  onEdit,
  onPhotos,
  onTogglePublished,
  onToggleFeatured,
  onDelete,
  onShowInterests,
}: Props) {
  const stock = stockLabel(product);
  const photoCount = product.images.length;

  return (
    <li
      className={`bg-white/[0.04] backdrop-blur-sm rounded-xl border border-white/[0.08] p-3.5 transition-opacity ${
        busy ? 'opacity-70' : ''
      }`}
    >
      <div className="flex items-start gap-3">
        <ProductImage
          image={product.primaryImage}
          category={product.category}
          alt={product.name}
          className="w-14 h-14 aspect-square rounded-lg shrink-0 border border-white/[0.06]"
          sizes="56px"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-bold text-white leading-snug line-clamp-2 min-w-0">
              {product.name}
            </h3>
            {busy && <Loader2 className="w-4 h-4 text-slate-400 animate-spin shrink-0 mt-0.5" />}
          </div>
          <p className="text-xs text-slate-400 truncate mt-0.5">
            {product.brand ? `${product.brand} · ` : ''}
            {product.categoryLabel}
            {product.sku ? <span className="text-slate-600"> · {product.sku}</span> : null}
          </p>
          <PriceTag product={product} className="mt-1" />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
            product.isActive
              ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400'
              : 'bg-white/[0.04] border-white/[0.1] text-slate-400'
          }`}
        >
          {product.isActive ? <Eye className="w-2.5 h-2.5" /> : <EyeOff className="w-2.5 h-2.5" />}
          {product.isActive ? 'Published' : 'Hidden'}
        </span>
        {product.isFeatured && <FeaturedBadge />}
        {stock.tone !== 'ok' && <StockPill product={product} />}
        {product.interestCount > 0 ? (
          <button
            type="button"
            onClick={onShowInterests}
            className="inline-flex items-center gap-1 rounded-full bg-pink-500/10 border border-pink-500/25 text-pink-300 px-2 py-0.5 text-[10px] font-semibold hover:bg-pink-500/20 cursor-pointer transition-colors"
            aria-label={`${product.interestCount} interested — view list`}
          >
            <Heart className="w-2.5 h-2.5 fill-current" />
            {product.interestCount} interested
          </button>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full border border-white/[0.06] text-slate-500 px-2 py-0.5 text-[10px] font-semibold">
            <Heart className="w-2.5 h-2.5" />0 interested
          </span>
        )}
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
            photoCount === 0
              ? 'border-amber-500/25 bg-amber-500/10 text-amber-300'
              : 'border-white/[0.06] text-slate-500'
          }`}
        >
          <Images className="w-2.5 h-2.5" />
          {photoCount === 0 ? 'No photos' : `${photoCount} photo${photoCount === 1 ? '' : 's'}`}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mt-3">
        <button type="button" onClick={onEdit} disabled={busy} className={neutralAction} aria-label="Edit product">
          <Pencil className="w-3.5 h-3.5" />
          <span className="hidden md:inline">Edit</span>
        </button>
        <button type="button" onClick={onPhotos} disabled={busy} className={neutralAction} aria-label="Manage photos">
          <Images className="w-3.5 h-3.5" />
          <span className="hidden md:inline">Photos</span>
        </button>
        <button
          type="button"
          onClick={onTogglePublished}
          disabled={busy}
          className={neutralAction}
          aria-label={product.isActive ? 'Unpublish product' : 'Publish product'}
        >
          {product.isActive ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          <span className="hidden md:inline">{product.isActive ? 'Unpublish' : 'Publish'}</span>
        </button>
        <button
          type="button"
          onClick={onToggleFeatured}
          disabled={busy}
          className={neutralAction}
          aria-label={product.isFeatured ? 'Remove from featured' : 'Mark as featured'}
        >
          {product.isFeatured ? <StarOff className="w-3.5 h-3.5" /> : <Star className="w-3.5 h-3.5" />}
          <span className="hidden md:inline">{product.isFeatured ? 'Unfeature' : 'Feature'}</span>
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          className={`${dangerAction} ml-auto`}
          aria-label="Delete product"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span className="hidden md:inline">Delete</span>
        </button>
      </div>
    </li>
  );
}
