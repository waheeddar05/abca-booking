import { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { verifyToken } from '@/lib/jwt';
import { prisma } from '@/lib/prisma';

export async function getAdminSession(req: NextRequest) {
  let email: string | null = null;

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (token?.email) {
    email = token.email;
  } else {
    const otpTokenStr = req.cookies.get('token')?.value;
    if (otpTokenStr) {
      try {
        const otpToken = verifyToken(otpTokenStr) as any;
        email = otpToken?.email || null;
      } catch {
        return null;
      }
    }
  }

  if (!email) return null;

  // Always fetch the current role from DB so admin-promoted roles take effect immediately
  const dbUser = await prisma.user.findUnique({
    where: { email },
    select: { role: true },
  });
  if (!dbUser) return null;

  return { role: dbUser.role, email };
}

export async function requireAdmin(req: NextRequest) {
  const session = await getAdminSession(req);
  if (session?.role !== 'ADMIN') return null;
  return session;
}

export async function requireOperatorOrAdmin(req: NextRequest) {
  const session = await getAdminSession(req);
  if (!session?.role || !['ADMIN', 'OPERATOR'].includes(session.role)) return null;
  return session;
}

export async function getOperatorSession(req: NextRequest) {
  const session = await getAdminSession(req);
  if (!session?.role || !['ADMIN', 'OPERATOR'].includes(session.role)) return null;
  const user = await prisma.user.findUnique({
    where: { email: session.email },
    select: { id: true },
  });
  if (!user) return null;
  return { ...session, userId: user.id, isAdmin: session.role === 'ADMIN' };
}
