import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';
import { resolveCurrentCenter } from '@/lib/centers';

// GET /api/packages - List available packages at the current center (public)
export async function GET(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    const center = await resolveCurrentCenter(req, user);
    if (!center) {
      return NextResponse.json({ error: 'No center available' }, { status: 503 });
    }

    const packages = await prisma.package.findMany({
      where: { centerId: center.id, isActive: true, isCustom: false },
      orderBy: { price: 'asc' },
      select: {
        id: true,
        centerId: true,
        name: true,
        machineId: true,
        machineType: true,
        ballType: true,
        wicketType: true,
        timingType: true,
        totalSessions: true,
        validityDays: true,
        price: true,
        extraChargeRules: true,
      },
    });

    return NextResponse.json(packages);
  } catch (error) {
    console.error('List packages error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
