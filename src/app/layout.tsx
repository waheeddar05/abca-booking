import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import Navbar from "@/components/Navbar";
import BottomNav from "@/components/BottomNav";
import { MultiCenterBanner } from "@/components/MultiCenterBanner";
import { Providers } from "@/components/Providers";
import { NamePrompt } from "@/components/NamePrompt";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { ToastProvider } from "@/components/ui/Toast";

import PWARegister from "@/components/PWARegister";
import { siteOrigin } from "@/lib/site-url";
import "./globals.css";

/**
 * The 1200×630 card WhatsApp, Instagram and Facebook show under a shared
 * link. Static asset under /images so the middleware never intercepts a
 * crawler's fetch of it; `metadataBase` turns it into the absolute URL the
 * Open Graph spec requires. Without it a shared playorbit.in link rendered
 * as a bare grey box — for a business marketed over WhatsApp, that card is
 * the storefront.
 */
const SHARE_IMAGE = {
  url: "/images/og-cover.jpg",
  width: 1200,
  height: 630,
  alt: "PlayOrbit — Train like a champion. Pro bowling machines, indoor nets and coaching in Pune.",
};

export const metadata: Metadata = {
  metadataBase: siteOrigin(),
  title: "PlayOrbit - Book Cricket Practice Sessions",
  description: "Book professional cricket practice sessions with advanced bowling machines. 4 pro machines, 3 pitch types, flexible 30-min slots.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "PlayOrbit",
  },
  openGraph: {
    title: "PlayOrbit — Book Cricket Practice in Pune",
    description: "Pro bowling machines, indoor nets, coaching and sidearm sessions. Pick a 30-minute slot and book in one tap.",
    type: "website",
    siteName: "PlayOrbit",
    locale: "en_IN",
    images: [SHARE_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: "PlayOrbit — Book Cricket Practice in Pune",
    description: "Pro bowling machines, indoor nets, coaching and sidearm sessions. Book a 30-minute slot in one tap.",
    images: [SHARE_IMAGE.url],
  },
  icons: {
    icon: [
      { url: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-384x384.png", sizes: "384x384", type: "image/png" },
    ],
    apple: [
      { url: "/icons/icon-384x384.png", sizes: "384x384" },
      { url: "/icons/icon-512x512.png", sizes: "512x512" },
    ],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1e3a5f",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} antialiased bg-[#0a1628] min-h-screen`}
      >
        <Providers>
          <ToastProvider>
            <ErrorBoundary>
              <Navbar />
              <MultiCenterBanner />
              <main className="pb-20 md:pb-0">{children}</main>
              <BottomNav />
              {/* Signed-in accounts with no name (every WhatsApp signup) get
                  asked for one here, once, wherever they happen to be. */}
              <NamePrompt />
            </ErrorBoundary>
          </ToastProvider>
          <PWARegister />
        </Providers>
      </body>
    </html>
  );
}
