'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Building2, ChevronDown, Check } from 'lucide-react';
import { useCenter } from '@/lib/center-context';

/**
 * Compact center selector for the user-facing Navbar.
 *
 * - Hidden when there's only one active center (no UX value).
 * - Shows current center's short name as a pill; click → dropdown.
 * - Dropdown lists every active center; selecting one calls switchTo()
 *   which sets the cookie and reloads the page.
 * - "See all centers" link at the bottom routes to /centers for the
 *   richer view (with geolocation, addresses, etc.).
 */
export function CenterSelector({ compact = false }: { compact?: boolean }) {
  const { centers, currentCenter, switchTo, loading } = useCenter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  if (loading || centers.length <= 1) return null;

  const label = currentCenter?.shortName || currentCenter?.name || 'Choose center';

  const handleSelect = async (id: string) => {
    if (id === currentCenter?.id) {
      setOpen(false);
      return;
    }
    setBusy(id);
    const ok = await switchTo(id);
    if (!ok) setBusy(null);
    // switchTo() reloads on success, so no further work needed.
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 rounded-lg font-medium transition-all cursor-pointer ${
          compact
            ? 'px-2 py-1.5 text-[11px] bg-white/[0.04] border border-white/[0.08] text-slate-300 hover:text-white hover:bg-white/[0.08]'
            : 'px-3 py-2 text-sm bg-white/[0.04] border border-white/[0.08] text-slate-200 hover:text-white hover:bg-white/[0.08]'
        }`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Building2 className={compact ? 'w-3 h-3 text-accent' : 'w-3.5 h-3.5 text-accent'} />
        <span className="truncate max-w-[7rem]">{label}</span>
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 min-w-[12rem] rounded-xl bg-[#0b1726] border border-white/[0.10] shadow-2xl overflow-hidden z-50">
          <div className="py-1 max-h-72 overflow-y-auto" role="listbox">
            {centers.map((c) => {
              const active = c.id === currentCenter?.id;
              const isBusy = busy === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => handleSelect(c.id)}
                  disabled={isBusy}
                  className={`w-full text-left px-3 py-2 flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                    active ? 'bg-accent/10' : 'hover:bg-white/[0.04]'
                  } ${isBusy ? 'opacity-60' : ''}`}
                  role="option"
                  aria-selected={active}
                >
                  <div className="min-w-0">
                    <div className={`text-xs font-medium truncate ${active ? 'text-accent' : 'text-white'}`}>
                      {c.name}
                    </div>
                    {c.city && (
                      <div className="text-[10px] text-slate-500 truncate">{c.city}</div>
                    )}
                  </div>
                  {active && <Check className="w-3.5 h-3.5 text-accent flex-shrink-0" />}
                </button>
              );
            })}
          </div>
          <Link
            href="/centers"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-[11px] text-slate-400 hover:text-white hover:bg-white/[0.04] border-t border-white/[0.06]"
          >
            See all centers →
          </Link>
        </div>
      )}
    </div>
  );
}
