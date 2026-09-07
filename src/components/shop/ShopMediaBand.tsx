'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { ShoppingBag } from 'lucide-react';

export const SHOP_BAND = {
  image: '/images/kis-gear-band.jpg',
  video: '/kis-hero.mp4',
  alt: 'KIS cricket bats in Kashmir willow at the Khan International Sports workshop, Anantnag',
};

/** Starts false so server and first client render agree, then corrects itself. */
function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/**
 * Full-bleed band above the product grid. The video is decorative: muted,
 * looping, `playsInline` so iOS plays it in place, and faded in only once it
 * can actually play — so a slow connection or blocked autoplay leaves the
 * poster showing rather than a black rectangle.
 */
export function ShopMediaBand({ image, alt, video }: { image: string; alt: string; video?: string }) {
  const reducedMotion = usePrefersReducedMotion();
  const [canPlay, setCanPlay] = useState(false);
  const showVideo = Boolean(video) && !reducedMotion;

  return (
    <div className="mb-3 md:mb-6 relative rounded-xl md:rounded-2xl overflow-hidden border border-white/[0.06] group">
      <div className="relative aspect-[16/8] md:aspect-[16/5] bg-[#050b14] overflow-hidden">
        <Image
          src={image}
          alt={alt}
          fill
          className="object-cover object-center opacity-70 group-hover:opacity-90 transition-all duration-700"
          loading="lazy"
          sizes="(max-width: 768px) 100vw, 1100px"
        />
        {showVideo && (
          <video
            src={video}
            poster={image}
            autoPlay
            muted
            loop
            playsInline
            preload="none"
            aria-hidden
            tabIndex={-1}
            onCanPlay={() => setCanPlay(true)}
            className={`absolute inset-0 w-full h-full object-cover object-center transition-opacity duration-700 ${
              canPlay ? 'opacity-70 group-hover:opacity-90' : 'opacity-0'
            }`}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-[#030712] via-[#030712]/55 to-transparent" />
        <div className="absolute inset-0 flex flex-col justify-center px-4 md:px-10">
          <span className="inline-flex items-center gap-1.5 w-fit px-2.5 py-1 rounded-full bg-accent/10 border border-accent/20 text-accent text-[8px] md:text-[10px] font-bold uppercase tracking-[0.2em] mb-1.5 md:mb-3">
            <ShoppingBag className="w-2.5 h-2.5 md:w-3 md:h-3" /> Hand-Picked Gear
          </span>
          <h4 className="text-base md:text-3xl font-black text-white leading-tight max-w-md drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">
            KASHMIR WILLOW, <span className="text-shimmer">PICKED IN PERSON.</span>
          </h4>
          <p className="text-slate-300 text-[9px] md:text-sm mt-0.5 md:mt-2 max-w-sm leading-relaxed">
            Feel the pickup on two or three before you decide. Collect at Toplay.
          </p>
        </div>
      </div>
    </div>
  );
}
