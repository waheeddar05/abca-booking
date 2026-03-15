'use client';

import { Phone, Instagram, MapPin } from 'lucide-react';
import { CONTACT_NUMBERS, INSTAGRAM_URL, LOCATION_URL } from '@/lib/client-constants';

interface ContactFooterProps {
  quote?: string;
  className?: string;
}

export function ContactFooter({
  quote = 'Champions Aren\'t Born. They\'re Built — Ball by Ball.',
  className = '',
}: ContactFooterProps) {
  return (
    <div className={`mt-8 pt-5 border-t border-white/[0.06] pb-20 md:pb-4 ${className}`}>
      <p className="text-center text-xs text-slate-500 italic mb-3">
        &ldquo;{quote}&rdquo;
      </p>

      <div className="max-w-4xl mx-auto rounded-xl md:rounded-2xl p-3 md:p-8 text-center border border-white/[0.08] bg-[#060d1b]/70 backdrop-blur-xl overflow-hidden relative">
        <div className="absolute inset-0 bg-gradient-to-br from-accent/[0.03] via-transparent to-purple-500/[0.02] -z-10"></div>
        <h2 className="text-lg md:text-3xl font-black text-white mb-0.5 md:mb-2">READY TO PLAY?</h2>
        <p className="text-slate-500 text-[10px] md:text-sm mb-3 md:mb-6 max-w-xl mx-auto leading-relaxed">Reach out via phone or Social Media.</p>

        <div className="grid grid-cols-5 gap-1.5 md:flex md:flex-row md:items-start md:justify-center md:gap-8 w-full">
          {CONTACT_NUMBERS.map((contact, idx) => (
            <span key={contact.number} className="contents">
              {idx > 0 && <div className="hidden md:block w-px h-16 bg-white/[0.06]"></div>}
              <a href={`tel:${contact.number}`} className="flex flex-col items-center gap-0.5 md:gap-1.5 group active:scale-95 transition-transform min-w-0">
                <div className="w-9 h-9 md:w-12 md:h-12 rounded-xl md:rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center group-hover:bg-accent group-hover:text-primary group-hover:border-accent/40 transition-all group-hover:shadow-[0_0_24px_rgba(56,189,248,0.25)] mb-0.5 md:mb-1 flex-shrink-0">
                  <Phone className="w-3.5 h-3.5 md:w-5 md:h-5" />
                </div>
                <span className="text-[8px] md:text-[11px] uppercase font-bold tracking-wider text-slate-600 truncate w-full">{contact.name}</span>
                <span className="text-white font-bold text-[9px] md:text-sm truncate w-full tabular-nums">{contact.number}</span>
              </a>
            </span>
          ))}
          <div className="hidden md:block w-px h-16 bg-white/[0.06]"></div>
          <a
            href={INSTAGRAM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center gap-0.5 md:gap-1.5 group active:scale-95 transition-transform min-w-0"
          >
            <div className="w-9 h-9 md:w-12 md:h-12 rounded-xl md:rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center group-hover:bg-[#E1306C] group-hover:text-white group-hover:border-[#E1306C]/40 transition-all group-hover:shadow-[0_0_24px_rgba(225,48,108,0.3)] mb-0.5 md:mb-1 flex-shrink-0">
              <Instagram className="w-3.5 h-3.5 md:w-5 md:h-5" />
            </div>
            <span className="text-[8px] md:text-[11px] uppercase font-bold tracking-wider text-slate-600 truncate w-full">Instagram</span>
            <span className="text-white font-bold text-[9px] md:text-sm truncate w-full">@playorbit.in</span>
          </a>
          <div className="hidden md:block w-px h-16 bg-white/[0.06]"></div>
          <a
            href={LOCATION_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center gap-0.5 md:gap-1.5 group active:scale-95 transition-transform min-w-0"
          >
            <div className="w-9 h-9 md:w-12 md:h-12 rounded-xl md:rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center group-hover:bg-accent group-hover:text-primary group-hover:border-accent/40 transition-all group-hover:shadow-[0_0_24px_rgba(56,189,248,0.25)] mb-0.5 md:mb-1 flex-shrink-0">
              <MapPin className="w-3.5 h-3.5 md:w-5 md:h-5" />
            </div>
            <span className="text-[8px] md:text-[11px] uppercase font-bold tracking-wider text-slate-600 truncate w-full">Location</span>
            <span className="text-white font-bold text-[9px] md:text-sm truncate w-full">Directions</span>
          </a>
        </div>
      </div>
    </div>
  );
}
