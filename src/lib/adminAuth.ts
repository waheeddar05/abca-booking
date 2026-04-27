import { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { verifyToken } from '@/lib/jwt';
import { prisma } from '@/lib/prisma';

const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || process.env.INITIAL_ADMIN_EMAIL || '';

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
    select: { id: true, role: true, isSuperAdmin: true },
  });
  if (!dbUser) return null;

  // Compute super-admin from DB column with bootstrap email fallback.
  const isSuperAdmin =
    dbUser.isSuperAdmin || (!!SUPER_ADMIN_EMAIL && email === SUPER_ADMIN_EMAIL);

  return { id: dbUser.id, role: dbUser.role, email, isSuperAdmin };
}

export async function requireAdmin(req: NextRequest) {
  const session = await getAdminSession(req);
  if (session?.role !== 'ADMIN') return null;
  return session;
}

/**
 * Allow only super admins. Use for cross-center operations:
 * managing centers, machine catalog, super-admin-only data fixes.
 */
export async function requireSuperAdmin(req: NextRequest) {
  const session = await getAdminSession(req);
  if (!session?.isSuperAdmin) return null;
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
