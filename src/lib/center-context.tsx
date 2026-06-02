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
  /** Multi-contact list. Each entry: { name?: string | null, number: string }.
   *  Preferred over `contactPhone` when present; readers should fall back
   *  to a one-entry list synthesised from contactPhone when this is null
   *  or empty so legacy data still renders. */
  contactPhones?: Array<{ name: string | null; number: string }> | null;
  contactEmail: string | null;
  mapUrl: string | null;
  logoUrl: string | null;
  themeColor: string | null;
}

interface CenterContextValue {
  centers: PublicCenter[];
  currentCenterId: string | null;
  currentCenter: PublicCenter | null;
  /** True if the signed-in user is a platform-wide super admin. */
  isSuperAdmin: boolean;
  /** Centers where the user holds an ADMIN membership. */
  adminCenterIds: string[];
  /** Centers where the user holds any staff (OPERATOR / COACH / SIDEARM) membership. */
  staffCenterIds: string[];
  /** Centers where the user holds a SIDEARM_SPECIALIST membership. */
  sidearmCenterIds: string[];
  /** True if super admin, or ADMIN membership at the currently-selected center. */
  isAdminAtCurrentCenter: boolean;
  /** True if super admin, ADMIN, or any staff membership at the currently-selected center. */
  isStaffAtCurrentCenter: boolean;
  /** True if the user is a SIDEARM_SPECIALIST at the currently-selected center.
   *  Drives the user-side Sidearm tab. (Super admins do NOT get this — it's a
   *  membership-specific capability, not an admin privilege.) */
  isSidearmSpecialistAtCurrentCenter: boolean;
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
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [adminCenterIds, setAdminCenterIds] = useState<string[]>([]);
  const [staffCenterIds, setStaffCenterIds] = useState<string[]>([]);
  const [sidearmCenterIds, setSidearmCenterIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/centers/me');
      if (!res.ok) return;
      const data = await res.json();
      setCenters((data.centers ?? []) as PublicCenter[]);
      setCurrentCenterId(data.currentCenterId ?? null);
      setIsSuperAdmin(Boolean(data.user?.isSuperAdmin));
      setAdminCenterIds((data.user?.adminCenterIds ?? []) as string[]);
      setStaffCenterIds((data.user?.staffCenterIds ?? []) as string[]);
      setSidearmCenterIds((data.user?.sidearmCenterIds ?? []) as string[]);
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

  const isAdminAtCurrentCenter =
    isSuperAdmin || (currentCenterId != null && adminCenterIds.includes(currentCenterId));
  const isStaffAtCurrentCenter =
    isAdminAtCurrentCenter ||
    (currentCenterId != null && staffCenterIds.includes(currentCenterId));
  // Membership-specific — deliberately NOT granted to super admins, since
  // there's no "own availability" to manage unless they actually hold a
  // SIDEARM_SPECIALIST membership here.
  const isSidearmSpecialistAtCurrentCenter =
    currentCenterId != null && sidearmCenterIds.includes(currentCenterId);

  const value = useMemo<CenterContextValue>(
    () => ({
      centers,
      currentCenterId,
      currentCenter,
      isSuperAdmin,
      adminCenterIds,
      staffCenterIds,
      sidearmCenterIds,
      isAdminAtCurrentCenter,
      isStaffAtCurrentCenter,
      isSidearmSpecialistAtCurrentCenter,
      loading,
      switchTo,
      refresh,
    }),
    [
      centers,
      currentCenterId,
      currentCenter,
      isSuperAdmin,
      adminCenterIds,
      staffCenterIds,
      sidearmCenterIds,
      isAdminAtCurrentCenter,
      isStaffAtCurrentCenter,
      isSidearmSpecialistAtCurrentCenter,
      loading,
      switchTo,
      refresh,
    ],
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
      isSuperAdmin: false,
      adminCenterIds: [],
      staffCenterIds: [],
      sidearmCenterIds: [],
      isAdminAtCurrentCenter: false,
      isStaffAtCurrentCenter: false,
      isSidearmSpecialistAtCurrentCenter: false,
      loading: false,
      switchTo: async () => false,
      refresh: async () => {},
    };
  }
  return ctx;
}
