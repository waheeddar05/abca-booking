import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import Navbar from "@/components/Navbar";
import BottomNav from "@/components/BottomNav";
import { Providers } from "@/components/Providers";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { ToastProvider } from "@/components/ui/Toast";

import PWARegister from "@/components/PWARegister";
import "./globals.css";

export const metadata: Metadata = {
  title: "PlayOrbit - Book Cricket Practice Sessions",
  description: "Book professional cricket practice sessions with advanced bowling machines. 4 pro machines, 3 pitch types, flexible 30-min slots.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "PlayOrbit",
  },
  openGraph: {
    title: "PlayOrbit",
    description: "Book professional cricket practice sessions. 4 bowling machines, 3 pitch types, morning & evening slots.",
    type: "website",
    siteName: "PlayOrbit",
  },
  twitter: {
    card: "summary",
    title: "PlayOrbit",
    description: "Book professional cricket practice sessions with advanced bowling machines.",
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
              <main className="pb-20 md:pb-0">{children}</main>
              <BottomNav />
            </ErrorBoundary>
          </ToastProvider>
          <PWARegister />
        </Providers>
      </body>
    </html>
  );
}
