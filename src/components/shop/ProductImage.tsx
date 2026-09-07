'use client';

import Image from 'next/image';
import type { MarketplaceImageMeta } from '@/lib/marketplace';
import { CATEGORY_ICONS, DEFAULT_CATEGORY_ICON } from './categoryIcons';

interface ProductImageProps {
  image: MarketplaceImageMeta | null | undefined;
  /** Category code — picks the placeholder glyph when there is no photo. */
  category?: string | null;
  alt: string;
  /** Tailwind classes for the wrapper (aspect ratio, rounding, size). */
  className?: string;
  /** `sizes` hint for the browser; defaults suit a 2-up phone grid. */
  sizes?: string;
  priority?: boolean;
}

/**
 * A product photo, or a category placeholder when none is uploaded yet.
 *
 * Rendered with `next/image` in `unoptimized` mode: photos are served
 * from our own `/api/shop/images/[id]` with an immutable cache, already
 * resized by the uploader, so the optimizer would only add a second
 * fetch hop and a cache miss per size. The wrapper must be `relative`
 * with a fixed aspect ratio — `fill` needs a sized box.
 */
export function ProductImage({ image, category, alt, className = '', sizes, priority }: ProductImageProps) {
  if (!image) {
    // A static lookup, not a component made during render — the lint rule
    // (react-hooks/static-components) rejects a factory call here.
    const Icon = CATEGORY_ICONS[category ?? ''] ?? DEFAULT_CATEGORY_ICON;
    return (
      <div
        className={`relative overflow-hidden bg-[#050b14] flex items-center justify-center ${className}`}
        aria-label={alt}
        role="img"
      >
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(56,189,248,0.10),transparent_65%)]" />
        <Icon className="w-9 h-9 md:w-12 md:h-12 text-accent/30" />
      </div>
    );
  }
  // The caller's `alt` wins: every caller passes the product's name (or
  // "name — photo 2 of 3"), which is what a card or gallery slot means. The
  // stored `image.alt` describes the photograph itself and, seeded from one
  // supplier shoot, read "KIS bats in Kashmir willow…" under an English
  // willow bat. It stays the fallback when a caller has nothing better.
  return (
    <div className={`relative overflow-hidden bg-[#050b14] ${className}`}>
      <Image
        src={image.url}
        alt={alt || image.alt || ''}
        fill
        unoptimized
        priority={priority}
        sizes={sizes || '(max-width: 768px) 50vw, 300px'}
        className="object-cover object-center"
      />
    </div>
  );
}
