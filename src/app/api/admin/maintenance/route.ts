import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { verifyToken } from '@/lib/jwt';
import {
  SUPER_ADMIN_EMAIL,
  getMaintenanceSettings,
  saveMaintenanceSettings,
} from '@/lib/maintenance';
import { prisma } from '@/lib/prisma';

async function getSuperAdminSession(req: NextRequest) {
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

function requireSuperAdmin(session: { role: string; email: string } | null) {
  if (!session || session.role !== 'ADMIN' || session.email !== SUPER_ADMIN_EMAIL) {
    return false;
  }
  return true;
}

// GET: Fetch current maintenance settings + list of admins for the UI
export async function GET(req: NextRequest) {
  try {
    const session = await getSuperAdminSession(req);
    if (!requireSuperAdmin(session)) {
      return NextResponse.json({ error: 'Only super admin can manage maintenance mode' }, { status: 403 });
    }

    const settings = await getMaintenanceSettings();

    // Fetch all admin users for the selection UI
    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN' },
      select: { id: true, name: true, email: true, image: true },
      orderBy: { name: 'asc' },
    });

    // Fetch all regular users for the selection UI
    const users = await prisma.user.findMany({
      where: { role: 'USER' },
      select: { id: true, name: true, email: true, image: true },
      orderBy: { name: 'asc' },
    });

    return NextResponse.json({ settings, admins, users });
  } catch (error) {
    console.error('Maintenance settings fetch error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST: Update maintenance settings
export async function POST(req: NextRequest) {
  try {
    const session = await getSuperAdminSession(req);
    if (!requireSuperAdmin(session)) {
      return NextResponse.json({ error: 'Only super admin can manage maintenance mode' }, { status: 403 });
    }

    const body = await req.json();

    const settings = {
      enabled: Boolean(body.enabled),
      message: typeof body.message === 'string' && body.message.trim()
        ? body.message.trim()
        : 'We are currently undergoing scheduled maintenance. Please check back soon.',
      allowAllAdmins: Boolean(body.allowAllAdmins),
      allowedEmails: Array.isArray(body.allowedEmails)
        ? body.allowedEmails.filter((e: unknown) => typeof e === 'string' && e.trim())
        : [],
    };

    await saveMaintenanceSettings(settings);

    return NextResponse.json({ message: 'Maintenance settings updated', settings });
  } catch (error) {
    console.error('Maintenance settings update error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
