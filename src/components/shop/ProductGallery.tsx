'use client';

import { useRef, useState, type KeyboardEvent, type TouchEvent } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { MarketplaceImageMeta } from '@/lib/marketplace';
import { ProductImage } from './ProductImage';

interface ProductGalleryProps {
  images: MarketplaceImageMeta[];
  /** Category code — picks the placeholder when there are no photos. */
  category: string;
  /** Product name, for alt text. */
  name: string;
}

/** Horizontal travel (px) that counts as a swipe rather than a tap. */
const SWIPE_THRESHOLD = 40;

/**
 * The product page's photo viewer: one tall (4:5) photo with prev/next
 * arrows and a thumbnail strip when there is more than one. Arrow keys
 * work when the viewer is focused and a horizontal swipe moves it on
 * touch. With no photos it shows the category placeholder and nothing
 * else — no arrows for a single frame.
 */
export function ProductGallery({ images, category, name }: ProductGalleryProps) {
  const [index, setIndex] = useState(0);
  const touchStartX = useRef<number | null>(null);

  const count = images.length;
  // The list can shrink between renders (a refetch after an admin edit);
  // never point past its end.
  const current = count > 0 ? Math.min(index, count - 1) : 0;
  const image = count > 0 ? images[current] : null;
  const multiple = count > 1;

  const go = (delta: number) => {
    if (!multiple) return;
    setIndex((current + delta + count) % count);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      go(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      go(1);
    }
  };

  const onTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  };

  const onTouchEnd = (e: TouchEvent<HTMLDivElement>) => {
    const start = touchStartX.current;
    touchStartX.current = null;
    if (start === null) return;
    const end = e.changedTouches[0]?.clientX;
    if (end === undefined) return;
    const delta = end - start;
    if (Math.abs(delta) < SWIPE_THRESHOLD) return;
    go(delta < 0 ? 1 : -1);
  };

  return (
    <div className="w-full min-w-0">
      <div
        className="relative w-full rounded-2xl overflow-hidden border border-white/[0.06] bg-[#050b14] outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        tabIndex={multiple ? 0 : undefined}
        onKeyDown={onKeyDown}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        role={multiple ? 'region' : undefined}
        aria-roledescription={multiple ? 'carousel' : undefined}
        aria-label={multiple ? `${name} photos` : undefined}
      >
        <ProductImage
          image={image}
          category={category}
          alt={count > 0 ? `${name} — photo ${current + 1} of ${count}` : name}
          className="aspect-[4/5] max-h-[70vh] w-full"
          sizes="(max-width: 768px) 100vw, 340px"
          priority
        />

        {multiple && (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label="Previous photo"
              className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/50 backdrop-blur-md border border-white/10 text-white flex items-center justify-center hover:bg-black/70 transition-colors cursor-pointer active:scale-95"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label="Next photo"
              className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/50 backdrop-blur-md border border-white/10 text-white flex items-center justify-center hover:bg-black/70 transition-colors cursor-pointer active:scale-95"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
            <span
              className="absolute bottom-2 right-2 rounded-full bg-black/60 backdrop-blur-md border border-white/10 px-2 py-0.5 text-[10px] font-semibold text-white tabular-nums"
              aria-live="polite"
            >
              {current + 1} / {count}
            </span>
          </>
        )}
      </div>

      {multiple && (
        <div
          className="flex gap-2 overflow-x-auto scrollbar-hide mt-2 -mx-4 px-4 md:mx-0 md:px-0 py-1"
          role="tablist"
          aria-label="Choose photo"
        >
          {images.map((img, i) => {
            const active = i === current;
            return (
              <button
                key={img.id}
                type="button"
                role="tab"
                aria-selected={active}
                aria-label={`Photo ${i + 1}`}
                onClick={() => setIndex(i)}
                className={`shrink-0 rounded-lg overflow-hidden border transition-all cursor-pointer ${
                  active
                    ? 'border-accent ring-2 ring-accent/60'
                    : 'border-white/[0.08] opacity-70 hover:opacity-100'
                }`}
              >
                <ProductImage
                  image={img}
                  category={category}
                  alt={`${name} thumbnail ${i + 1}`}
                  className="h-16 w-16"
                  sizes="64px"
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
