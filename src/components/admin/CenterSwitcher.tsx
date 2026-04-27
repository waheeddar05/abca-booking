'use client';

import { useEffect, useRef, useState } from 'react';
import { Building2, Check, ChevronDown, Loader2 } from 'lucide-react';

type CenterOption = {
  id: string;
  slug: string;
  name: string;
  shortName: string | null;
  bookingModel: 'MACHINE_PITCH' | 'RESOURCE_BASED';
};

type Payload = {
  user: { id: string; role: string; isSuperAdmin: boolean } | null;
  centers: CenterOption[];
  currentCenterId: string | null;
};

/**
 * Compact center switcher for the admin sidebar.
 *
 * - Shows the currently active center.
 * - Admins see only centers they're a member of (the API returns those).
 * - Super admins see every active center.
 * - Selecting a center calls /api/centers/select which sets the
 *   `selectedCenterId` cookie, then reloads so SSR routes pick it up.
 */
export function CenterSwitcher() {
  const [data, setData] = useState<Payload | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/centers/me')
      .then((r) => r.json())
      .then((d) => { if (active) setData(d); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  // Close on outside click
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  if (!data) {
    return (
      <div className="px-3 py-2 rounded-xl bg-white/[0.02] border border-white/[0.06] text-xs text-slate-500 flex items-center gap-2">
        <Loader2 className="w-3 h-3 animate-spin" /> Loading…
      </div>
    );
  }

  // Hide entirely if there's only one option and the user isn't a super
  // admin (no point switching when there's nowhere to go).
  if (!data.user?.isSuperAdmin && data.centers.length <= 1) {
    return null;
  }

  const current = data.centers.find((c) => c.id === data.currentCenterId) ?? data.centers[0] ?? null;

  const select = async (centerId: string) => {
    if (centerId === data.currentCenterId) {
      setOpen(false);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/centers/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ centerId }),
      });
      if (res.ok) {
        // Hard reload — admin pages may have rendered with the previous
        // center on the server and need to re-run with the new cookie.
        window.location.reload();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err?.error || 'Failed to switch center');
        setBusy(false);
      }
    } catch {
      setBusy(false);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.06] hover:border-white/[0.10] transition-all text-left cursor-pointer disabled:opacity-60"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Building2 className="w-3.5 h-3.5 text-accent flex-shrink-0" />
          <div className="min-w-0">
            <div className="text-[9px] uppercase tracking-wider text-slate-500 leading-none">Center</div>
            <div className="text-xs font-semibold text-white truncate leading-tight mt-0.5">
              {current?.shortName || current?.name || '—'}
            </div>
          </div>
        </div>
        {busy ? (
          <Loader2 className="w-3.5 h-3.5 text-slate-400 animate-spin flex-shrink-0" />
        ) : (
          <ChevronDown className={`w-3.5 h-3.5 text-slate-400 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        )}
      </button>

      {open && (
        <div className="absolute left-0 right-0 mt-1 rounded-xl bg-[#0b1726] border border-white/[0.10] shadow-2xl z-50 overflow-hidden">
          <div className="max-h-60 overflow-y-auto py-1">
            {data.centers.map((c) => {
              const active = c.id === data.currentCenterId;
              return (
                <button
                  key={c.id}
                  onClick={() => select(c.id)}
                  className={`w-full text-left px-3 py-2 flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                    active ? 'bg-accent/10' : 'hover:bg-white/[0.04]'
                  }`}
                >
                  <div className="min-w-0">
                    <div className={`text-xs font-medium truncate ${active ? 'text-accent' : 'text-white'}`}>
                      {c.name}
                    </div>
                    <div className="text-[10px] text-slate-500 truncate">
                      {c.slug} · {c.bookingModel === 'RESOURCE_BASED' ? 'resource-based' : 'machine/pitch'}
                    </div>
                  </div>
                  {active && <Check className="w-3.5 h-3.5 text-accent flex-shrink-0" />}
                </button>
              );
            })}
          </div>
          {data.user?.isSuperAdmin && (
            <a
              href="/admin/centers"
              className="block px-3 py-2 text-[11px] text-slate-400 hover:text-white hover:bg-white/[0.04] border-t border-white/[0.06]"
            >
              Manage centers →
            </a>
          )}
        </div>
      )}
    </div>
  );
}
