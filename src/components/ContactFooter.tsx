'use client';

import { Phone, Instagram, MapPin, Mail } from 'lucide-react';
import { INSTAGRAM_URL } from '@/lib/client-constants';
import { useCenter } from '@/lib/center-context';

interface ContactFooterProps {
  quote?: string;
  className?: string;
}

/**
 * Footer with phone numbers, social, and map link.
 *
 * Multi-center: Phones come from `currentCenter.contactPhones` (the
 * multi-contact list set per center). Falls back to a one-entry list
 * synthesised from `currentCenter.contactPhone` for centers that
 * haven't migrated yet. The legacy platform-wide CONTACT_NUMBERS
 * allowlist is no longer used — surfacing those on a multi-center
 * install meant "Vinay / Surya / …" appeared on Toplay pages even
 * though those staff are ABCA-only. Location uses the center's
 * `mapUrl` only; centers with no map URL just hide the chip.
 */
export function ContactFooter({
  quote = 'Champions Aren\'t Born. They\'re Built — Ball by Ball.',
  className = '',
}: ContactFooterProps) {
  const { currentCenter } = useCenter();

  const centerEmail = currentCenter?.contactEmail || null;
  const mapUrl = (currentCenter?.mapUrl ?? '').trim();

  // Multi-contact list. Each entry: { name?: string | null, number: string }.
  // Same fallback ladder LandingPageClient uses so the user sees the
  // same set of contacts on the landing page and on every inner page
  // (slots, bookings, packages). Empty numbers are stripped so a stale
  // row doesn't render a chip with no digits.
  const phoneContacts: Array<{ name: string | null; number: string }> = (() => {
    const list = currentCenter?.contactPhones;
    if (Array.isArray(list) && list.length > 0) {
      return list
        .map((c) => ({
          name: (c?.name ?? '').trim() || null,
          number: (c?.number ?? '').trim(),
        }))
        .filter((c) => c.number.length > 0);
    }
    const single = (currentCenter?.contactPhone ?? '').trim();
    return single.length > 0 ? [{ name: null, number: single }] : [];
  })();

  return (
    <div className={`mt-8 pt-5 border-t border-white/[0.06] pb-20 md:pb-4 ${className}`}>
      <p className="text-center text-xs text-slate-500 italic mb-3">
        &ldquo;{quote}&rdquo;
      </p>

      <div className="max-w-4xl mx-auto rounded-xl md:rounded-2xl p-3 md:p-8 text-center border border-white/[0.08] bg-[#060d1b]/70 backdrop-blur-xl overflow-hidden relative">
        <div className="absolute inset-0 bg-gradient-to-br from-accent/[0.03] via-transparent to-purple-500/[0.02] -z-10"></div>
        <h2 className="text-lg md:text-3xl font-black text-white mb-0.5 md:mb-2">READY TO PLAY?</h2>
        <p className="text-slate-500 text-[10px] md:text-sm mb-3 md:mb-6 max-w-xl mx-auto leading-relaxed">
          {currentCenter
            ? <>Reach out to <span className="text-slate-300 font-semibold">{currentCenter.shortName || currentCenter.name}</span> via phone or social.</>
            : 'Reach out via phone or Social Media.'}
        </p>

        <div className="flex flex-wrap items-start justify-center gap-3 md:gap-8 w-full">
          {/* Per-center phone contacts. The first row gets the accent
              treatment so the center's primary number still stands out
              even when several rows exist. */}
          {phoneContacts.map((c, idx) => {
            const primary = idx === 0;
            return (
              <a
                key={`${c.number}-${idx}`}
                href={`tel:${c.number}`}
                className="flex flex-col items-center gap-0.5 md:gap-1.5 group active:scale-95 transition-transform min-w-0"
              >
                <div
                  className={`w-9 h-9 md:w-12 md:h-12 rounded-xl flex items-center justify-center transition-all mb-0.5 md:mb-1 flex-shrink-0 ${
                    primary
                      ? 'bg-accent/15 border border-accent/30 group-hover:bg-accent group-hover:text-primary group-hover:shadow-[0_0_24px_rgba(56,189,248,0.35)]'
                      : 'bg-white/[0.04] border border-white/[0.08] group-hover:bg-accent group-hover:text-primary group-hover:border-accent/40 group-hover:shadow-[0_0_24px_rgba(56,189,248,0.25)]'
                  }`}
                >
                  <Phone className="w-3.5 h-3.5 md:w-5 md:h-5" />
                </div>
                <span
                  className={`text-[8px] md:text-[11px] uppercase font-bold tracking-wider truncate w-full text-center ${
                    primary ? 'text-accent' : 'text-slate-600'
                  }`}
                >
                  {c.name || currentCenter?.shortName || currentCenter?.name || 'Phone'}
                </span>
                <span className="text-white font-bold text-[9px] md:text-sm truncate w-full tabular-nums text-center">
                  {c.number}
                </span>
              </a>
            );
          })}

          {centerEmail && (
            <a
              href={`mailto:${centerEmail}`}
              className="flex flex-col items-center gap-0.5 md:gap-1.5 group active:scale-95 transition-transform min-w-0"
            >
              <div className="w-9 h-9 md:w-12 md:h-12 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center group-hover:bg-accent group-hover:text-primary group-hover:border-accent/40 transition-all mb-0.5 md:mb-1 flex-shrink-0">
                <Mail className="w-3.5 h-3.5 md:w-5 md:h-5" />
              </div>
              <span className="text-[8px] md:text-[11px] uppercase font-bold tracking-wider text-slate-600 truncate w-full text-center">Email</span>
              <span className="text-white font-bold text-[9px] md:text-sm truncate w-full text-center">{centerEmail.split('@')[0]}</span>
            </a>
          )}

          <a
            href={INSTAGRAM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center gap-0.5 md:gap-1.5 group active:scale-95 transition-transform min-w-0"
          >
            <div className="w-9 h-9 md:w-12 md:h-12 rounded-xl md:rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center group-hover:bg-[#E1306C] group-hover:text-white group-hover:border-[#E1306C]/40 transition-all group-hover:shadow-[0_0_24px_rgba(225,48,108,0.3)] mb-0.5 md:mb-1 flex-shrink-0">
              <Instagram className="w-3.5 h-3.5 md:w-5 md:h-5" />
            </div>
            <span className="text-[8px] md:text-[11px] uppercase font-bold tracking-wider text-slate-600 truncate w-full text-center">Instagram</span>
            <span className="text-white font-bold text-[9px] md:text-sm truncate w-full text-center">@playorbit.in</span>
          </a>
          {mapUrl && (
            <a
              href={mapUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col items-center gap-0.5 md:gap-1.5 group active:scale-95 transition-transform min-w-0"
            >
              <div className="w-9 h-9 md:w-12 md:h-12 rounded-xl md:rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center group-hover:bg-accent group-hover:text-primary group-hover:border-accent/40 transition-all group-hover:shadow-[0_0_24px_rgba(56,189,248,0.25)] mb-0.5 md:mb-1 flex-shrink-0">
                <MapPin className="w-3.5 h-3.5 md:w-5 md:h-5" />
              </div>
              <span className="text-[8px] md:text-[11px] uppercase font-bold tracking-wider text-slate-600 truncate w-full text-center">Location</span>
              <span className="text-white font-bold text-[9px] md:text-sm truncate w-full text-center">Directions</span>
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
