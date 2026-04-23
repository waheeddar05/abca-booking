import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { verifyToken } from "@/lib/jwt";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Maintenance kill switch — env-var based so it works without a DB read.
  // Allow the maintenance page itself and its status endpoint through.
  if (
    process.env.MAINTENANCE_MODE === 'true' &&
    pathname !== '/maintenance' &&
    !pathname.startsWith('/api/maintenance') &&
    !pathname.startsWith('/_next') &&
    !pathname.startsWith('/images/') &&
    !pathname.startsWith('/icons/') &&
    pathname !== '/favicon.ico' &&
    pathname !== '/sw.js' &&
    pathname !== '/manifest.json'
  ) {
    return NextResponse.rewrite(new URL('/maintenance', req.url));
  }

  // Define public paths
  const isPublicPath =
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/otp" ||
    pathname === "/maintenance" ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/webhooks/") ||
    pathname.startsWith("/api/maintenance") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    pathname.startsWith("/images/") ||
    pathname.startsWith("/icons/") ||
    pathname === "/sw.js" ||
    pathname === "/manifest.json" ||
    pathname.startsWith("/.well-known/") ||
    pathname === "/privacy-policy";

  // The verify-mobile page is accessible to authenticated but unverified users
  const isVerifyMobilePath = pathname === "/verify-mobile";

  if (isPublicPath) {
    // If the user is logged in and tries to access login or otp page, redirect
    if (pathname === "/login" || pathname === "/otp") {
      const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
      const otpTokenStr = req.cookies.get("token")?.value;
      const otpToken = otpTokenStr ? verifyToken(otpTokenStr) as any : null;

      if (token || otpToken) {
        const role = (token?.role || otpToken?.role) as string | undefined;
        if (role === 'OPERATOR') {
          return NextResponse.redirect(new URL("/operator", req.url));
        }
        // Check if mobile is verified — redirect to verify-mobile if not
        const mobileVerified = token?.mobileVerified as boolean | undefined;
        if (token && !mobileVerified && role !== 'ADMIN' && role !== 'OPERATOR') {
          return NextResponse.redirect(new URL("/verify-mobile", req.url));
        }
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

  if (!token && !otpToken) {
    const loginUrl = new URL("/", req.url);
    return NextResponse.redirect(loginUrl);
  }

  // Get user info
  const userRole = (token?.role || otpToken?.role) as string | undefined;

  // Mobile verification gate: if user has a NextAuth session but hasn't verified
  // their mobile number, redirect them to /verify-mobile (except for admin/operator/API)
  if (
    token &&
    !isVerifyMobilePath &&
    !pathname.startsWith("/api/") &&
    userRole !== "ADMIN" &&
    userRole !== "OPERATOR"
  ) {
    const mobileVerified = token.mobileVerified as boolean | undefined;
    if (!mobileVerified) {
      return NextResponse.redirect(new URL("/verify-mobile", req.url));
    }
  }

  // Allow access to /verify-mobile for authenticated but unverified users
  if (isVerifyMobilePath) {
    return NextResponse.next();
  }

  // Protect Admin routes
  if (pathname.startsWith("/admin")) {
    if (userRole !== "ADMIN") {
      return NextResponse.redirect(new URL("/", req.url));
    }
  }

  // Protect Operator routes
  if (pathname.startsWith("/operator")) {
    if (userRole !== "OPERATOR" && userRole !== "ADMIN") {
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
     * - api/maintenance (maintenance status endpoint)
     * - login (login page)
     * - otp (otp page)
     * - maintenance (maintenance page)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - images (public images)
     */
    "/((?!api/auth|api/webhooks|api/maintenance|login|otp|maintenance|_next/static|_next/image|favicon.ico|images|icons|sw\\.js|manifest\\.json|\\.well-known|privacy-policy).*)",
  ],
};
