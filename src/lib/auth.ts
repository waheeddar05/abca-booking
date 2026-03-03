import { NextRequest } from 'next/server';
import { getServerSession } from "next-auth/next";
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/jwt';
import { authOptions } from '@/lib/authOptions';

const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || process.env.INITIAL_ADMIN_EMAIL || '';

export async function getAuthenticatedUser(req: NextRequest) {
  let userId: string | undefined;
  let userName: string | undefined;
  let userRole: string | undefined;
  let userEmail: string | undefined;
  let isFreeUser = false;
  let mobileVerified = false;

  // Check for NextAuth session
  const session = await getServerSession(authOptions);
  if (session?.user?.email) {
    const dbUser = await prisma.user.findUnique({
      where: { email: session.user.email },
    });
    userId = dbUser?.id;
    userName = dbUser?.name || undefined;
    userRole = dbUser?.role;
    userEmail = dbUser?.email || undefined;
    isFreeUser = dbUser?.isFreeUser || false;
    mobileVerified = dbUser?.mobileVerified || false;
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
      userEmail = dbUser?.email || undefined;
      isFreeUser = dbUser?.isFreeUser || false;
      mobileVerified = dbUser?.mobileVerified || false;
    }
  }

  if (!userId) return null;

  const isSuperAdmin = !!(userEmail && SUPER_ADMIN_EMAIL && userEmail === SUPER_ADMIN_EMAIL);

  return { id: userId, name: userName, role: userRole, email: userEmail, isSuperAdmin, isFreeUser, mobileVerified };
}
