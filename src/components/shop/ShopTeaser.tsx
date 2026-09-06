'use client';

import { MessageCircle, Sparkles } from 'lucide-react';
import { buildWhatsAppLink, type MarketplaceCategoryId } from '@/lib/marketplace';
import { CATEGORY_TILES } from './categoryIcons';

/** The launch line-up, in the order it is announced. */
const TEASER_CATEGORIES: ReadonlyArray<MarketplaceCategoryId> = [
  'BAT',
  'GLOVES',
  'THIGH_GUARD',
  'PADS',
  'HELMET',
  'ACCESSORY',
];

const TEASER_TILES = TEASER_CATEGORIES.flatMap((value) => {
  const tile = CATEGORY_TILES.find((t) => t.value === value);
  return tile ? [tile] : [];
});

const TEASER_ENQUIRY = 'Hi PlayOrbit, I’m interested in your upcoming cricket gear store.';

interface ShopTeaserProps {
  centerName: string | null;
  /** WhatsApp digits (with country code) or null when the center has none. */
  enquiryPhone: string | null;
}

/**
 * What /shop shows while the store is switched on but has no published
 * products yet: the categories that are coming, plus a WhatsApp line for
 * anyone who wants to ask before the shelves fill.
 */
export function ShopTeaser({ centerName, enquiryPhone }: ShopTeaserProps) {
  const whatsAppLink = buildWhatsAppLink(enquiryPhone, TEASER_ENQUIRY);

  return (
    <section className="animate-fade-in">
      <div className="text-center mb-5">
        <div className="w-14 h-14 rounded-2xl bg-accent/10 flex items-center justify-center mx-auto mb-3">
          <Sparkles className="w-6 h-6 text-accent" />
        </div>
        <h2 className="text-lg font-black text-white">Gear is on its way</h2>
        <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto leading-relaxed">
          We’re stocking bats, gloves, guards and more{centerName ? ` for ${centerName}` : ''}. Here’s
          what’s coming to the shelves first.
        </p>
      </div>

      <ul className="grid grid-cols-2 gap-2.5">
        {TEASER_TILES.map((tile) => (
          <li
            key={tile.value}
            className="bg-white/[0.04] backdrop-blur-sm rounded-xl border border-white/[0.08] p-3.5 flex flex-col gap-2 min-w-0"
          >
            <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center">
              <tile.icon className="w-4 h-4 text-accent" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-white leading-snug">{tile.label}</p>
              <p className="text-[11px] text-slate-400 leading-snug mt-0.5">{tile.blurb}</p>
            </div>
          </li>
        ))}
      </ul>

      {whatsAppLink && (
        <a
          href={whatsAppLink}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-5 w-full inline-flex items-center justify-center gap-2 bg-accent hover:bg-accent-light text-primary font-bold rounded-xl px-4 py-2.5 text-sm transition-colors active:scale-[0.98]"
        >
          <MessageCircle className="w-4 h-4" />
          Ask us on WhatsApp
        </a>
      )}
    </section>
  );
}
