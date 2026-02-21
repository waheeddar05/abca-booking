import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Navbar from "@/components/Navbar";
import { Providers } from "@/components/Providers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Ankeet Bawane Cricket Academy - Book Practice Sessions",
  description: "Book professional cricket practice sessions with advanced bowling machines at Ankeet Bawane Cricket Academy. 4 pro machines, 3 pitch types, flexible 30-min slots.",
  openGraph: {
    title: "Ankeet Bawane Cricket Academy",
    description: "Book professional cricket practice sessions. 4 bowling machines, 3 pitch types, morning & evening slots.",
    type: "website",
    siteName: "ABCA Booking",
  },
  twitter: {
    card: "summary",
    title: "Ankeet Bawane Cricket Academy",
    description: "Book professional cricket practice sessions with advanced bowling machines.",
  },
  icons: {
    icon: "/images/logo-v2.jpeg",
    apple: "/images/logo-v2.jpeg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
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
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-[#0a1628] min-h-screen`}
      >
        <Providers>
          <Navbar />
          <main className="safe-bottom">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
