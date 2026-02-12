import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { verifyToken } from "@/lib/jwt";

const SUPER_ADMIN_EMAIL = 'waheeddar8@gmail.com';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Define public paths
  const isPublicPath =
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/otp" ||
    pathname === "/maintenance" ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/maintenance") ||
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

  // Get user info
  const userEmail = (token?.email || otpToken?.email) as string | undefined;
  const userRole = (token?.role || otpToken?.role) as string | undefined;

  // Protect Admin routes
  if (pathname.startsWith("/admin")) {
    if (userRole !== "ADMIN") {
      return NextResponse.redirect(new URL("/", req.url));
    }
  }

  // Maintenance mode check
  // Fetch maintenance status from our internal API
  try {
    const maintenanceUrl = new URL("/api/maintenance/status", req.url);
    const maintenanceRes = await fetch(maintenanceUrl, {
      headers: { 'Cache-Control': 'no-cache' },
    });

    if (maintenanceRes.ok) {
      const maintenance = await maintenanceRes.json();

      if (maintenance.enabled) {
        // Super admin always has access
        if (userEmail === SUPER_ADMIN_EMAIL) {
          return NextResponse.next();
        }

        // Check if all admins are allowed
        if (maintenance.allowAllAdmins && userRole === 'ADMIN') {
          return NextResponse.next();
        }

        // Check if specific email is allowed
        if (userEmail && Array.isArray(maintenance.allowedEmails) && maintenance.allowedEmails.includes(userEmail)) {
          return NextResponse.next();
        }

        // User is not allowed - redirect to maintenance page (for pages) or return 503 (for APIs)
        if (pathname.startsWith("/api/")) {
          return NextResponse.json(
            { error: 'Service temporarily unavailable', message: maintenance.message },
            { status: 503 }
          );
        }

        return NextResponse.redirect(new URL("/maintenance", req.url));
      }
    }
  } catch (error) {
    // If maintenance check fails, allow access to avoid locking everyone out
    console.error('Maintenance check failed:', error);
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
     */
    "/((?!api/auth|api/maintenance|login|otp|maintenance|_next/static|_next/image|favicon.ico).*)",
  ],
};
