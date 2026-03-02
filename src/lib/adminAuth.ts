import { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { verifyToken } from '@/lib/jwt';

export async function getAdminSession(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (token) return { role: token.role as string, email: token.email as string };

  const otpTokenStr = req.cookies.get('token')?.value;
  if (otpTokenStr) {
    try {
      const otpToken = verifyToken(otpTokenStr) as any;
      return { role: otpToken?.role, email: otpToken?.email };
    } catch {
      return null;
    }
  }
  return null;
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
  // Need to look up userId from email
  const { prisma } = await import('@/lib/prisma');
  const user = await prisma.user.findUnique({ where: { email: session.email } });
  if (!user) return null;
  return { ...session, userId: user.id, isAdmin: session.role === 'ADMIN' };
}
