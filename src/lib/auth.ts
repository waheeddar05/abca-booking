import { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/jwt';

const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || process.env.INITIAL_ADMIN_EMAIL || '';

// Minimal select for auth — only fetch the fields we actually return.
const AUTH_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  isFreeUser: true,
  mobileVerified: true,
} as const;

export async function getAuthenticatedUser(req: NextRequest) {
  // 1. Try NextAuth JWT first (local decode, no HTTP request — ~1ms vs ~500ms for getServerSession)
  const nextAuthToken = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (nextAuthToken?.email) {
    const dbUser = await prisma.user.findUnique({
      where: { email: nextAuthToken.email },
      select: AUTH_USER_SELECT,
    });
    if (dbUser) {
      const isSuperAdmin = !!(dbUser.email && SUPER_ADMIN_EMAIL && dbUser.email === SUPER_ADMIN_EMAIL);
      return {
        id: dbUser.id,
        name: dbUser.name || undefined,
        role: dbUser.role,
        email: dbUser.email || undefined,
        isSuperAdmin,
        isFreeUser: dbUser.isFreeUser || false,
        mobileVerified: dbUser.mobileVerified || false,
      };
    }
  }

  // 2. Fallback to custom OTP JWT
  const otpTokenStr = req.cookies.get('token')?.value;
  if (otpTokenStr) {
    const decoded = verifyToken(otpTokenStr) as any;
    if (decoded?.userId) {
      const dbUser = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: AUTH_USER_SELECT,
      });
      if (dbUser) {
        const isSuperAdmin = !!(dbUser.email && SUPER_ADMIN_EMAIL && dbUser.email === SUPER_ADMIN_EMAIL);
        return {
          id: dbUser.id,
          name: dbUser.name || undefined,
          role: dbUser.role,
          email: dbUser.email || undefined,
          isSuperAdmin,
          isFreeUser: dbUser.isFreeUser || false,
          mobileVerified: dbUser.mobileVerified || false,
        };
      }
    }
  }

  return null;
}
