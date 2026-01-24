import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { prisma } from "@/lib/prisma";

const handler = NextAuth({
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
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
        (session.user as any).role = token.role;
      }
      return session;
    },
    async signIn({ user, account }) {
      if (account?.provider === "google") {
        const email = user.email;
        if (!email) return false;

        let dbUser = await prisma.user.findUnique({
          where: { email },
        });

        if (!dbUser) {
          const isInitialAdmin = email === process.env.INITIAL_ADMIN_EMAIL;
          dbUser = await prisma.user.create({
            data: {
              email,
              name: user.name,
              authProvider: "GOOGLE",
              role: isInitialAdmin ? "ADMIN" : "USER",
            },
          });
        }
        user.id = dbUser.id;
        (user as any).role = dbUser.role;
        return true;
      }
      return true;
    },
  },
  pages: {
    signIn: "/login",
  },
});

export { handler as GET, handler as POST };
