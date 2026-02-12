import { NextRequest } from 'next/server';
import { getServerSession } from "next-auth/next";
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/jwt';
import { authOptions } from '@/lib/authOptions';

export async function getAuthenticatedUser(req: NextRequest) {
  let userId: string | undefined;
  let userName: string | undefined;
  let userRole: string | undefined;

  // Check for NextAuth session
  const session = await getServerSession(authOptions);
  if (session?.user?.email) {
    const dbUser = await prisma.user.findUnique({
      where: { email: session.user.email },
    });
    userId = dbUser?.id;
    userName = dbUser?.name || undefined;
    userRole = dbUser?.role;
  }

  // Check for JWT token if no NextAuth session
  if (!userId) {
    const token = req.cookies.get('token')?.value;
    const decoded = token ? (verifyToken(token) as any) : null;
    if (decoded?.userId) {
      userId = decoded.userId;
      const dbUser = await prisma.user.findUnique({
        where: { id: userId },
      });
      userName = dbUser?.name || undefined;
      userRole = dbUser?.role;
    }
  }

  if (!userId) return null;

  return { id: userId, name: userName, role: userRole };
}
