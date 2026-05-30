import { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { prisma } from "@/lib/prisma";
import { getCachedPolicy } from "@/lib/policy-cache";

const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || process.env.INITIAL_ADMIN_EMAIL || '';

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET,
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id;
        token.role = (user as any).role;
        token.image = (user as any).image;
        token.isFreeUser = (user as any).isFreeUser || false;
        token.isSpecialUser = (user as any).isSpecialUser || false;
        token.mobileVerified = (user as any).mobileVerified || false;
      }

      // Refresh role from DB periodically so admin-promoted roles take effect
      // without requiring the user to sign out and back in.
      // Also force-refresh when updateSession() is called (trigger === "update")
      // so that mobileVerified is immediately picked up after verification.
      const now = Date.now();
      const lastRefresh = (token.roleRefreshedAt as number) || 0;
      const shouldRefresh = trigger === "update" || (now - lastRefresh > 60_000);
      if (shouldRefresh && token.email) {
        try {
          const dbUser = await prisma.user.findUnique({
            where: { email: token.email },
            select: { role: true, isSuperAdmin: true, isFreeUser: true, isSpecialUser: true, mobileVerified: true },
          });
          if (dbUser) {
            token.role = dbUser.role;
            token.isSuperAdmin = dbUser.isSuperAdmin || false;
            token.isFreeUser = dbUser.isFreeUser || false;
            token.isSpecialUser = dbUser.isSpecialUser || false;
            token.mobileVerified = dbUser.mobileVerified || false;
          }
          token.roleRefreshedAt = now;
        } catch {
          // If DB check fails, keep existing token values
        }
      }

      // For existing sessions where mobileVerified is false,
      // check if WhatsApp login is even enabled — if not, bypass the gate
      if (!token.mobileVerified && token.role !== 'ADMIN' && token.role !== 'OPERATOR') {
        try {
          const whatsappEnabled = await getCachedPolicy('WHATSAPP_LOGIN_ENABLED');
          if (whatsappEnabled !== 'true') {
            token.mobileVerified = true;
          }
        } catch {
          // If policy check fails, don't block the user
          token.mobileVerified = true;
        }
      }

      // Always compute from token email so existing sessions pick it up.
      // The DB flag (User.isSuperAdmin) is also refreshed via the periodic
      // role refresh above; either source promotes the user.
      token.isSuperAdmin =
        token.isSuperAdmin === true ||
        !!(token.email && SUPER_ADMIN_EMAIL && token.email === SUPER_ADMIN_EMAIL);
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
        (session.user as any).role = token.role;
        (session.user as any).isSuperAdmin = token.isSuperAdmin || false;
        (session.user as any).isFreeUser = token.isFreeUser || false;
        (session.user as any).isSpecialUser = token.isSpecialUser || false;
        (session.user as any).mobileVerified = token.mobileVerified || false;
        if (token.image) {
          session.user.image = token.image as string;
        }
      }
      return session;
    },
    async signIn({ user, account, profile }) {
      if (account?.provider === "google") {
        const email = user.email;
        if (!email) return false;

        const googleImage = (profile as any)?.picture || user.image || null;

        let dbUser = await prisma.user.findUnique({
          where: { email },
        });

        const isSuperAdminEmail =
          !!SUPER_ADMIN_EMAIL && email === SUPER_ADMIN_EMAIL;

        if (!dbUser) {
          const isInitialAdmin = email === process.env.INITIAL_ADMIN_EMAIL;
          dbUser = await prisma.user.create({
            data: {
              email,
              name: user.name,
              image: googleImage,
              authProvider: "GOOGLE",
              role: isInitialAdmin ? "ADMIN" : "USER",
              isSuperAdmin: isSuperAdminEmail,
              lastSeen: new Date(),
            },
          });
        } else {
          // Update image and lastSeen on every sign-in.
          // Also: if the env identifies this user as super admin but the
          // DB flag is false (e.g. legacy users created before the
          // multi-center migration), promote them now. Never demote.
          const updateData: Record<string, unknown> = { lastSeen: new Date() };
          if (googleImage && dbUser.image !== googleImage) {
            updateData.image = googleImage;
          }
          if (isSuperAdminEmail && !dbUser.isSuperAdmin) {
            updateData.isSuperAdmin = true;
          }
          dbUser = await prisma.user.update({
            where: { id: dbUser.id },
            data: updateData,
          });
        }
        user.id = dbUser.id;
        (user as any).role = dbUser.role;
        (user as any).image = dbUser.image;
        (user as any).isFreeUser = dbUser.isFreeUser;
        (user as any).isSpecialUser = dbUser.isSpecialUser;

        // If WhatsApp login is not enabled, skip mobile verification gate
        // so users aren't stuck at /verify-mobile with no way to verify
        let mobileVerified = dbUser.mobileVerified;
        if (!mobileVerified) {
          const whatsappEnabled = await getCachedPolicy('WHATSAPP_LOGIN_ENABLED');
          if (whatsappEnabled !== 'true') {
            mobileVerified = true;
          }
        }
        (user as any).mobileVerified = mobileVerified;
        return true;
      }
      return true;
    },
  },
  pages: {
    signIn: "/",
  },
};
