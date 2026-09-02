import { redirect } from "next/navigation";
import { getToken } from "next-auth/jwt";
import type { NextRequest } from "next/server";
import { headers, cookies } from "next/headers";
import { verifyToken } from "@/lib/jwt";
import { NEXTAUTH_SECRET } from "@/lib/auth-secret";
import LandingPageClient from "@/components/LandingPageClient";

export default async function Home() {
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
    redirect("/slots");
  }

  return <LandingPageClient />;
}
