import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// GET /api/packages - List available packages (public)
export async function GET() {
  try {
    const packages = await prisma.package.findMany({
      where: { isActive: true, isCustom: false },
      orderBy: { price: 'asc' },
      select: {
        id: true,
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
