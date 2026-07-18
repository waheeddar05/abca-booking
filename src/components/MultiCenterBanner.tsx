'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSyncExternalStore } from 'react';
import { MapPin, ArrowRight, X } from 'lucide-react';
import { useCenter } from '@/lib/center-context';

/**
 * App-wide "PlayOrbit is multi-location" banner.
 *
 * Why this exists: with 2+ active centers, the only multi-center signal in the
 * user app was the compact navbar switcher, which is easy to miss — so most
 * users assumed PlayOrbit had a single location. This slim bar makes the real
 * center count unmissable and keeps an "explore all centers" link one tap away.
 *
 * Behaviour:
 * - Only renders when 2+ active centers exist (single-center installs see
 *   nothing, exactly as before).
 * - Dismissible; the choice is remembered in localStorage. After dismissal the
 *   persistent affordance is the (now count-badged) navbar CenterSelector, so
 *   "explore centers" is always reachable.
 * - Hidden on the landing/login pages and the admin/staff/operator layouts
 *   (they have their own chrome) and on /centers itself (redundant there).
 */

const DISMISS_KEY = 'po_multicenter_banner_dismissed_v1';

// Dismissal lives in localStorage, exposed through a tiny external store so the
// banner can react to it via useSyncExternalStore (no mount effect / setState,
// which the react-hooks lint rules disallow). The native `storage` event only
// fires in *other* tabs, so we keep an in-tab listener set for same-tab updates.
const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === DISMISS_KEY) cb();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', onStorage);
  };
}

function getDismissedSnapshot(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    // Private mode / storage disabled — treat as not dismissed so it shows.
    return false;
  }
}

// On the server (and during hydration) act dismissed so nothing renders until
// the client takes over — the center list is client-loaded anyway.
function getServerSnapshot(): boolean {
  return true;
}

function dismiss(): void {
  try {
    localStorage.setItem(DISMISS_KEY, '1');
  } catch {
    // Non-fatal — still hide it for this tab via the listener notify below.
  }
  listeners.forEach((l) => l());
}

// Route prefixes that run in their own layout / already surface centers.
const HIDDEN_PREFIXES = ['/admin', '/staff', '/operator'];
const HIDDEN_EXACT = ['/', '/login', '/otp', '/centers', '/verify-mobile', '/maintenance'];

export function MultiCenterBanner() {
  const pathname = usePathname();
  const { centers, currentCenter, loading } = useCenter();
  const dismissed = useSyncExternalStore(subscribe, getDismissedSnapshot, getServerSnapshot);

  const hiddenRoute =
    HIDDEN_EXACT.includes(pathname) ||
    HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));

  if (loading) return null;
  if (hiddenRoute) return null;
  if (centers.length <= 1) return null;
  if (dismissed) return null;

  const label = currentCenter?.shortName || currentCenter?.name;

  return (
    <div className="relative z-40 border-b border-accent/15 bg-gradient-to-r from-accent/[0.12] via-accent/[0.06] to-transparent">
      <div className="max-w-5xl mx-auto px-4">
        <div className="flex items-center gap-2 py-1.5 text-[11px] md:text-xs">
          <span className="flex items-center gap-1.5 rounded-full bg-accent/15 border border-accent/25 text-accent font-bold px-2 py-0.5 flex-shrink-0">
            <MapPin className="w-3 h-3" />
            {centers.length} locations
          </span>
          <span className="text-slate-300 truncate min-w-0">
            PlayOrbit has {centers.length} locations
            {label ? (
              <>
                {' '}
                — you’re at <span className="text-white font-semibold">{label}</span>
              </>
            ) : null}
            .
          </span>
          <Link
            href="/centers"
            className="ml-auto flex items-center gap-1 text-accent font-semibold hover:text-accent-light transition-colors flex-shrink-0 whitespace-nowrap"
          >
            Explore all
            <ArrowRight className="w-3 h-3" />
          </Link>
          <button
            onClick={dismiss}
            aria-label="Dismiss multi-center notice"
            className="flex-shrink-0 text-slate-500 hover:text-white transition-colors p-0.5 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
