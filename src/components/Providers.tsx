'use client';

import { SessionProvider } from "next-auth/react";
import { CenterProvider } from "@/lib/center-context";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <CenterProvider>{children}</CenterProvider>
    </SessionProvider>
  );
}
