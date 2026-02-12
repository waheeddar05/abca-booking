import { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { prisma } from "@/lib/prisma";

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
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
        (session.user as any).role = token.role;
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
        return true;
      }
      return true;
    },
  },
  pages: {
    signIn: "/login",
  },
};
