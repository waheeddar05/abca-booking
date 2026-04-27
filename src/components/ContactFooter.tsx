'use client';

import { Phone, Instagram, MapPin, Mail } from 'lucide-react';
import { CONTACT_NUMBERS, INSTAGRAM_URL, LOCATION_URL } from '@/lib/client-constants';
import { useCenter } from '@/lib/center-context';

interface ContactFooterProps {
  quote?: string;
  className?: string;
}

/**
 * Footer with phone numbers, social, and map link.
 *
 * Multi-center: When the active center has its own contact phone / email
 * / map URL configured, those override the global defaults. Centers
 * without specifics fall back to the platform-wide CONTACT_NUMBERS list,
 * Instagram URL, and LOCATION_URL — preserving day-one behaviour for
 * single-center installs.
 */
export function ContactFooter({
  quote = 'Champions Aren\'t Born. They\'re Built — Ball by Ball.',
  className = '',
}: ContactFooterProps) {
  const { currentCenter } = useCenter();

  // If the center has at least one contact phone, surface it as a single
  // primary contact and keep the platform-wide list for additional staff.
  const centerPhone = currentCenter?.contactPhone || null;
  const centerEmail = currentCenter?.contactEmail || null;
  const mapUrl = currentCenter?.mapUrl || LOCATION_URL;

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

        <div className="grid grid-cols-5 gap-1.5 md:flex md:flex-row md:items-start md:justify-center md:gap-8 w-full">
          {/* Center-specific primary contact (if set). Shown FIRST so it doesn't get cut off on mobile. */}
          {centerPhone && (
            <a
              href={`tel:${centerPhone}`}
              className="flex flex-col items-center gap-0.5 md:gap-1.5 group active:scale-95 transition-transform min-w-0"
            >
              <div className="w-9 h-9 md:w-12 md:h-12 rounded-xl md:rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center group-hover:bg-accent group-hover:text-primary transition-all group-hover:shadow-[0_0_24px_rgba(56,189,248,0.35)] mb-0.5 md:mb-1 flex-shrink-0">
                <Phone className="w-3.5 h-3.5 md:w-5 md:h-5" />
              </div>
              <span className="text-[8px] md:text-[11px] uppercase font-bold tracking-wider text-accent truncate w-full">
                {currentCenter?.shortName || currentCenter?.name || 'Center'}
              </span>
              <span className="text-white font-bold text-[9px] md:text-sm truncate w-full tabular-nums">{centerPhone}</span>
            </a>
          )}

          {/* Platform-wide individual staff numbers, only shown if no center-specific phone is set. */}
          {!centerPhone && CONTACT_NUMBERS.map((contact, idx) => (
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

          {centerEmail && (
            <>
              <div className="hidden md:block w-px h-16 bg-white/[0.06]"></div>
              <a
                href={`mailto:${centerEmail}`}
                className="flex flex-col items-center gap-0.5 md:gap-1.5 group active:scale-95 transition-transform min-w-0"
              >
                <div className="w-9 h-9 md:w-12 md:h-12 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center group-hover:bg-accent group-hover:text-primary group-hover:border-accent/40 transition-all mb-0.5 md:mb-1 flex-shrink-0">
                  <Mail className="w-3.5 h-3.5 md:w-5 md:h-5" />
                </div>
                <span className="text-[8px] md:text-[11px] uppercase font-bold tracking-wider text-slate-600 truncate w-full">Email</span>
                <span className="text-white font-bold text-[9px] md:text-sm truncate w-full">{centerEmail.split('@')[0]}</span>
              </a>
            </>
          )}

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
            href={mapUrl}
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
