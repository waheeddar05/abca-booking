'use client';

/**
 * Client-side center context.
 *
 * Single source of truth for "what center am I on?" in the user app.
 * - Fetches `/api/centers/me` once on mount.
 * - Exposes `useCenter()` so any component can read the current center
 *   and the list of available centers without re-fetching.
 * - `switchTo(id)` updates the cookie via `/api/centers/select` and
 *   reloads the page so SSR routes pick up the new selection.
 *
 * This is intentionally lightweight — it does not include the kind of
 * data the API holds for the admin UI (booking model, Razorpay config).
 * Just slug, name, contact, location.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export interface PublicCenter {
  id: string;
  slug: string;
  name: string;
  shortName: string | null;
  isActive: boolean;
  bookingModel: 'MACHINE_PITCH' | 'RESOURCE_BASED';
  description: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  latitude: number | null;
  longitude: number | null;
  contactPhone: string | null;
  contactEmail: string | null;
  mapUrl: string | null;
  logoUrl: string | null;
  themeColor: string | null;
}

interface CenterContextValue {
  centers: PublicCenter[];
  currentCenterId: string | null;
  currentCenter: PublicCenter | null;
  /** True until the first /api/centers/me response. */
  loading: boolean;
  /** Switches the cookie + reloads. Resolves true on success. */
  switchTo: (centerId: string) => Promise<boolean>;
  /** Forces a refetch of /api/centers/me (e.g. after creating a center). */
  refresh: () => Promise<void>;
}

const CenterContext = createContext<CenterContextValue | null>(null);

export function CenterProvider({ children }: { children: ReactNode }) {
  const [centers, setCenters] = useState<PublicCenter[]>([]);
  const [currentCenterId, setCurrentCenterId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/centers/me');
      if (!res.ok) return;
      const data = await res.json();
      setCenters((data.centers ?? []) as PublicCenter[]);
      setCurrentCenterId(data.currentCenterId ?? null);
    } catch {
      // Network failure or auth route blip — keep stale state.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const switchTo = useCallback(async (centerId: string): Promise<boolean> => {
    try {
      const res = await fetch('/api/centers/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ centerId }),
      });
      if (!res.ok) return false;
      // Reload so SSR pages re-render with the new cookie.
      window.location.reload();
      return true;
    } catch {
      return false;
    }
  }, []);

  const currentCenter = useMemo(
    () => centers.find((c) => c.id === currentCenterId) ?? null,
    [centers, currentCenterId],
  );

  const value = useMemo<CenterContextValue>(
    () => ({ centers, currentCenterId, currentCenter, loading, switchTo, refresh }),
    [centers, currentCenterId, currentCenter, loading, switchTo, refresh],
  );

  return <CenterContext.Provider value={value}>{children}</CenterContext.Provider>;
}

export function useCenter(): CenterContextValue {
  const ctx = useContext(CenterContext);
  if (!ctx) {
    // Fallback no-op context so a component can mount in tests/storybook
    // without the provider. Real app always has the provider.
    return {
      centers: [],
      currentCenterId: null,
      currentCenter: null,
      loading: false,
      switchTo: async () => false,
      refresh: async () => {},
    };
  }
  return ctx;
}
