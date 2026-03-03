import { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { prisma } from "@/lib/prisma";

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
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as any).role;
        token.image = (user as any).image;
        token.isFreeUser = (user as any).isFreeUser || false;
        token.mobileVerified = (user as any).mobileVerified || false;
      }
      // Always compute from token email so existing sessions pick it up
      token.isSuperAdmin = !!(token.email && SUPER_ADMIN_EMAIL && token.email === SUPER_ADMIN_EMAIL);
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
        (session.user as any).role = token.role;
        (session.user as any).isSuperAdmin = token.isSuperAdmin || false;
        (session.user as any).isFreeUser = token.isFreeUser || false;
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

        if (!dbUser) {
          const isInitialAdmin = email === process.env.INITIAL_ADMIN_EMAIL;
          dbUser = await prisma.user.create({
            data: {
              email,
              name: user.name,
              image: googleImage,
              authProvider: "GOOGLE",
              role: isInitialAdmin ? "ADMIN" : "USER",
            },
          });
        } else {
          // Update image on every sign-in to keep it fresh
          if (googleImage && dbUser.image !== googleImage) {
            dbUser = await prisma.user.update({
              where: { id: dbUser.id },
              data: { image: googleImage },
            });
          }
        }
        user.id = dbUser.id;
        (user as any).role = dbUser.role;
        (user as any).image = dbUser.image;
        (user as any).isFreeUser = dbUser.isFreeUser;
        (user as any).mobileVerified = dbUser.mobileVerified;
        return true;
      }
      return true;
    },
  },
  pages: {
    signIn: "/",
  },
};
