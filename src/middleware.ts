import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { verifyToken } from "@/lib/jwt";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Define public paths
  const isPublicPath =
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/otp" ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico";

  console.log(`Middleware: ${pathname}, isPublic: ${isPublicPath}, cookies: ${req.cookies.get("token")?.value ? 'exists' : 'none'}`);

  if (isPublicPath) {
    // If the user is logged in and tries to access login or otp page, redirect to slots
    if (pathname === "/login" || pathname === "/otp") {
      const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
      const otpTokenStr = req.cookies.get("token")?.value;
      const otpToken = otpTokenStr ? verifyToken(otpTokenStr) as any : null;

      if (token || otpToken) {
        console.log(`Middleware: Authenticated user on ${pathname}, redirecting to /slots`);
        return NextResponse.redirect(new URL("/slots", req.url));
      }
    }
    return NextResponse.next();
  }

  // Check for NextAuth session
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  
  // Check for custom OTP token in cookies
  const otpTokenStr = req.cookies.get("token")?.value;
  const otpToken = otpTokenStr ? verifyToken(otpTokenStr) as any : null;

  console.log(`Middleware: ${pathname}, token: ${!!token}, otpToken: ${!!otpToken}`);

  if (!token && !otpToken) {
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  // Protect Admin routes
  if (pathname.startsWith("/admin")) {
    const role = token?.role || otpToken?.role;
    if (role !== "ADMIN") {
      return NextResponse.redirect(new URL("/", req.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api/auth (NextAuth endpoints)
     * - login (login page)
     * - otp (otp page)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!api/auth|login|otp|_next/static|_next/image|favicon.ico).*)",
  ],
};
