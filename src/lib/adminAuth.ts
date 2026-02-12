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
