import { redirect } from "next/navigation";
import { getToken } from "next-auth/jwt";
import type { NextRequest } from "next/server";
import { headers, cookies } from "next/headers";
import { verifyToken } from "@/lib/jwt";
import { NEXTAUTH_SECRET } from "@/lib/auth-secret";
import LandingPageClient from "@/components/LandingPageClient";
import { DEFAULT_POST_LOGIN_PATH, safeNextPath } from "@/lib/login-href";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const cookieStore = await cookies();
  const token = await getToken({
    req: {
      headers: await headers(),
      cookies: cookieStore,
      // App Router gives headers/cookies separately; getToken only reads
      // those two off the request.
    } as unknown as NextRequest,
    secret: NEXTAUTH_SECRET
  });

  const otpTokenStr = cookieStore.get("token")?.value;
  const otpToken = otpTokenStr ? await verifyToken(otpTokenStr) : null;

  if (token || otpToken) {
    // `/?login=1&next=/shop/abc` from a page that needed a sign-in: an
    // already signed-in visitor goes straight back there. Same-origin
    // paths only (see `safeNextPath`).
    const { next } = await searchParams;
    redirect(safeNextPath(Array.isArray(next) ? next[0] : next) ?? DEFAULT_POST_LOGIN_PATH);
  }

  return <LandingPageClient />;
}
