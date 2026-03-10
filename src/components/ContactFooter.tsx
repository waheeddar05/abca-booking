'use client';

import { Phone, Instagram, MapPin } from 'lucide-react';
import { CONTACT_NUMBERS, INSTAGRAM_URL, LOCATION_URL } from '@/lib/client-constants';

interface ContactFooterProps {
  quote?: string;
  showInstagram?: boolean;
}

export function ContactFooter({
  quote = 'Champions Aren\'t Born. They\'re Built — Ball by Ball.',
  showInstagram = false,
}: ContactFooterProps) {
  return (
    <div className="mt-8 pt-5 border-t border-white/[0.06] pb-4">
      <p className="text-center text-xs text-slate-500 italic mb-3">
        &ldquo;{quote}&rdquo;
      </p>
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[11px] text-slate-500">
        {CONTACT_NUMBERS.map((contact) => (
          <a
            key={contact.number}
            href={`tel:${contact.number}`}
            className="flex items-center gap-1.5 hover:text-accent transition-colors"
          >
            <Phone className="w-3 h-3" />
            {contact.name}: {contact.number}
          </a>
        ))}
        {showInstagram && (
          <a
            href={INSTAGRAM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 hover:text-accent transition-colors"
          >
            <Instagram className="w-3 h-3" />
            @playorbit.in
          </a>
        )}
        <a
          href={LOCATION_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 hover:text-accent transition-colors"
        >
          <MapPin className="w-3 h-3" />
          Location
        </a>
      </div>
    </div>
  );
}
