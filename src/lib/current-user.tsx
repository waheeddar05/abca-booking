'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

/**
 * The one client-side source of truth for "who is signed in".
 *
 * PlayOrbit has two session mechanisms — the custom OTP JWT in the `token`
 * cookie (WhatsApp login, the only way in) and NextAuth (legacy Google
 * sessions, still valid until they expire). `useSession()` only ever sees
 * the second one, so every gate written against it silently reports
 * "signed out" for a WhatsApp user: empty admin sidebars, super-admin
 * pages that hide themselves, free-booking detection that never fires.
 *
 * `GET /api/user/profile` goes through `getAuthenticatedUser`, which
 * already understands both mechanisms, so this provider reads from there
 * and hands every gate the same answer the server would give. Fetched once
 * per mount and shared through context, replacing the per-component
 * `/api/user/profile` fetches that Navbar and BottomNav used to each do on
 * their own.
 */

export interface CurrentUser {
  id: string;
  name: string | null;
  email: string | null;
  role: string;
  mobileNumber: string | null;
  mobileVerified: boolean;
  phonePromptDismissed: boolean;
  authProvider: string | null;
  image: string | null;
  isSuperAdmin: boolean;
  /** Runs the Cricket Store — platform-level, not a center membership. */
  isStoreAdmin: boolean;
  isFreeUser: boolean;
  isSpecialUser: boolean;
}

interface CurrentUserContextValue {
  user: CurrentUser | null;
  /** True until the first fetch settles — gates should wait rather than flash "signed out". */
  loading: boolean;
  isAuthenticated: boolean;
  /** Re-read the profile, e.g. after linking a mobile number. */
  refresh: () => Promise<void>;
}

const CurrentUserContext = createContext<CurrentUserContextValue>({
  user: null,
  loading: true,
  isAuthenticated: false,
  refresh: async () => {},
});

export function CurrentUserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/user/profile');
      // Signed-out has two shapes: the route's own 401, and middleware
      // redirecting an unauthenticated /api/* request to the landing page,
      // which arrives as a followed 307 (status 200, HTML body). Treat both
      // as signed out; a thrown fetch is a network blip, not a logout.
      const isJson = res.headers.get('content-type')?.includes('application/json') ?? false;
      if (res.status === 401 || res.redirected || !isJson) {
        setUser(null);
        return;
      }
      if (!res.ok) return;
      const data = await res.json();
      setUser(data && data.id ? (data as CurrentUser) : null);
    } catch {
      // Leave the last known user in place rather than signing them out.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <CurrentUserContext.Provider
      value={{ user, loading, isAuthenticated: !!user, refresh: load }}
    >
      {children}
    </CurrentUserContext.Provider>
  );
}

export function useCurrentUser(): CurrentUserContextValue {
  return useContext(CurrentUserContext);
}
