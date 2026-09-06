import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { verifyToken } from "@/lib/jwt";
import { NEXTAUTH_SECRET } from "@/lib/auth-secret";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Maintenance kill switch — env-var based so it works without a DB read.
  if (process.env.MAINTENANCE_MODE === 'true') {
    const bypassKey = process.env.MAINTENANCE_BYPASS_KEY;

    // Verification bypass: visiting any URL with ?mbk=<key> drops a cookie
    // that lets THIS browser through while everyone else keeps seeing the
    // maintenance page. Auth-free and DB-free, so it works even while the
    // database is mid-migration. The secret is then stripped from the URL.
    if (bypassKey && req.nextUrl.searchParams.get('mbk') === bypassKey) {
      const cleanUrl = req.nextUrl.clone();
      cleanUrl.searchParams.delete('mbk');
      const res = NextResponse.redirect(cleanUrl);
      res.cookies.set('mb', bypassKey, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 8, // 8-hour verification window
      });
      return res;
    }

    const hasBypass = !!bypassKey && req.cookies.get('mb')?.value === bypassKey;

    // Allow the maintenance page itself, its status endpoint, and assets.
    const isMaintenanceAllowed =
      pathname === '/maintenance' ||
      pathname.startsWith('/api/maintenance') ||
      // Per-center map redirect (booking template "View Location" button) —
      // a tapped map link must resolve even during maintenance.
      pathname.startsWith('/loc/') ||
      pathname.startsWith('/_next') ||
      pathname.startsWith('/images/') ||
      pathname.startsWith('/icons/') ||
      pathname === '/favicon.ico' ||
      pathname === '/sw.js' ||
      pathname === '/manifest.json';

    if (!hasBypass && !isMaintenanceAllowed) {
      return NextResponse.rewrite(new URL('/maintenance', req.url));
    }
    // Bypass holders fall through to normal routing below.
  }

  // Define public paths
  const isPublicPath =
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/otp" ||
    pathname === "/maintenance" ||
    // /centers and the related read-only API are part of the multi-center
    // public surface so a brand-new visitor can pick a center before sign-in.
    pathname === "/centers" ||
    pathname.startsWith("/api/centers") ||
    // The store is a marketing surface too: anyone can browse /shop and
    // its catalog API before signing in. Routes under /api/shop that need
    // a user ("Notify me") check the session themselves and answer a JSON
    // 401 instead of the HTML redirect a protected path would get.
    pathname === "/shop" ||
    pathname.startsWith("/shop/") ||
    pathname.startsWith("/api/shop") ||
    // /loc/[slug] → per-center map redirect for the booking template's
    // "View Location" button; must be reachable without auth.
    pathname.startsWith("/loc/") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/webhooks/") ||
    // Vercel Cron requests carry no session cookie — only the
    // `Authorization: Bearer <CRON_SECRET>` header, which each cron route
    // verifies itself (fail-closed). Without this exemption the middleware
    // redirected cron GETs to "/", so the payment-reconcile safety net
    // never ran and paid-but-unconfirmed bookings sat until the customer
    // happened to reopen the app.
    pathname.startsWith("/api/cron/") ||
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
      const token = await getToken({ req, secret: NEXTAUTH_SECRET });
      const otpTokenStr = req.cookies.get("token")?.value;
      const otpToken = otpTokenStr ? await verifyToken(otpTokenStr) : null;

      if (token || otpToken) {
        const role = (token?.role || otpToken?.role) as string | undefined;
        // OPERATOR users land on the merged staff dashboard. The page
        // surfaces tabs for whatever roles they hold (operator + coach
        // + sidearm). /operator stays as a redirect for old PWA installs.
        if (role === 'OPERATOR') {
          return NextResponse.redirect(new URL("/staff", req.url));
        }
        // Check if mobile is verified — redirect to verify-mobile if not
        const mobileVerified = token?.mobileVerified as boolean | undefined;
        if (token && !mobileVerified && role !== 'ADMIN' && role !== 'MODERATOR' && role !== 'OPERATOR') {
          return NextResponse.redirect(new URL("/verify-mobile", req.url));
        }
        return NextResponse.redirect(new URL("/slots", req.url));
      }
    }
    return NextResponse.next();
  }

  // Check for NextAuth session
  const token = await getToken({ req, secret: NEXTAUTH_SECRET });

  // Check for custom OTP token in cookies
  const otpTokenStr = req.cookies.get("token")?.value;
  const otpToken = otpTokenStr ? await verifyToken(otpTokenStr) : null;

  if (!token && !otpToken) {
    const loginUrl = new URL("/", req.url);
    return NextResponse.redirect(loginUrl);
  }

  // Get user info
  const userRole = (token?.role || otpToken?.role) as string | undefined;

  // Mobile verification gate: if user has a NextAuth session but hasn't verified
  // their mobile number, redirect them to /verify-mobile (except for
  // admin/operator + the unified /staff dashboard / API).
  if (
    token &&
    !isVerifyMobilePath &&
    !pathname.startsWith("/api/") &&
    !pathname.startsWith("/staff") &&
    userRole !== "ADMIN" &&
    userRole !== "MODERATOR" &&
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

  // Protect Admin routes. ADMIN gets the full panel; SIDEARM_SPECIALIST
  // and COACH are let in so they can self-manage their availability on
  // the /admin/sidearm and /admin/coach pages (the layout gates every
  // other link away from them).
  if (pathname.startsWith("/admin")) {
    const isStorePath = pathname === "/admin/shop" || pathname.startsWith("/admin/shop/");
    // Platform-level grants ride in the WhatsApp session token (set at
    // OTP verify). A token issued before those claims existed carries
    // neither, and is treated as "unknown" — the API guard decides.
    const storeAdminClaim = otpToken?.isStoreAdmin === true;
    const superAdminClaim = otpToken?.isSuperAdmin === true;
    const claimsKnown =
      typeof otpToken?.isStoreAdmin === "boolean" && typeof otpToken?.isSuperAdmin === "boolean";

    const hasAdminRole =
      userRole === "ADMIN" ||
      userRole === "MODERATOR" ||
      userRole === "SIDEARM_SPECIALIST" ||
      userRole === "COACH";

    if (!hasAdminRole) {
      // A store admin who is otherwise a plain USER gets exactly one
      // admin surface: the Cricket Store. Everything else under /admin
      // bounces there, the same way a specialist only gets their tab.
      if (!storeAdminClaim) {
        return NextResponse.redirect(new URL("/", req.url));
      }
      if (!isStorePath) {
        return NextResponse.redirect(new URL("/admin/shop", req.url));
      }
    } else if (isStorePath && claimsKnown && !storeAdminClaim && !superAdminClaim) {
      // The store is not a center's: a center admin / specialist / coach
      // without the store grant is turned away at the edge. The API
      // rejects them regardless (requireShopAdmin).
      return NextResponse.redirect(new URL("/admin", req.url));
    }

    // Moderators are restricted admins. They reach most of the panel but
    // are blocked outright from Users, Settings, and center configuration
    // ("My Center"/Centers) — plus the super-admin-only tools. Enforce it
    // at the edge so a direct URL can't bypass the hidden nav links. The
    // matching API routes carry their own guards as a second layer.
    if (userRole === "MODERATOR") {
      const moderatorBlockedPrefixes = [
        "/admin/users",
        "/admin/user-management",
        "/admin/configuration",
        "/admin/policies",
        "/admin/centers",
        "/admin/maintenance",
        "/admin/db-cleanup",
        "/admin/payments",
        // Staff management and Offers are full-admin surfaces too:
        // moderators run the day-to-day floor (bookings, slots,
        // packages, ledger) but do not staff the center or price it.
        "/admin/operators",
        "/admin/sidearm",
        "/admin/coach",
        "/admin/ground-staff",
        "/admin/offers",
        // Marketplace (store catalog, prices, images) is pricing — full
        // admins only, same as Offers.
        "/admin/shop",
      ];
      if (moderatorBlockedPrefixes.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
        return NextResponse.redirect(new URL("/admin", req.url));
      }
    }
  }

  // Legacy /operator routes — the dashboard moved to /staff so any
  // authenticated user (operator, coach, sidearm specialist, admin)
  // should land on the unified page. Forwarding here keeps old PWA
  // installs and bookmarks working for non-operator staff that the
  // /operator page-level redirect can't reach because middleware
  // bounces them first.
  if (pathname.startsWith("/operator")) {
    const dest = new URL("/staff", req.url);
    dest.search = req.nextUrl.search;
    return NextResponse.redirect(dest);
  }

  // Protect Staff routes — any signed-in user can land here; the
  // page itself shows a "no role" notice when the user has no
  // OPERATOR / COACH / SIDEARM_SPECIALIST membership at the active
  // center, so we don't need a hard role check at the edge. Mobile
  // verification is bypassed so an unverified-mobile coach can still
  // see their assigned sessions.

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
    "/((?!api/auth|api/webhooks|api/cron|api/maintenance|login|otp|maintenance|_next/static|_next/image|favicon.ico|images|icons|sw\\.js|manifest\\.json|\\.well-known|privacy-policy).*)",
  ],
};
