'use client';

import { SessionProvider } from "next-auth/react";
import { CenterProvider } from "@/lib/center-context";
import { CurrentUserProvider } from "@/lib/current-user";

/**
 * `SessionProvider` stays mounted so any still-valid legacy Google session
 * keeps working, but it is no longer what gates the UI: `CurrentUserProvider`
 * is, because it reads the profile through `getAuthenticatedUser` and so
 * sees WhatsApp logins too. See `@/lib/current-user`.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <CurrentUserProvider>
        <CenterProvider>{children}</CenterProvider>
      </CurrentUserProvider>
    </SessionProvider>
  );
}
