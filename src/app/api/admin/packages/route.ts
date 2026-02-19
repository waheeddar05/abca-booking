import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/adminAuth';

// GET /api/admin/packages - List all packages (with filters)
export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { searchParams } = new URL(req.url);
    const activeOnly = searchParams.get('activeOnly') === 'true';

    const where: any = {};
    if (activeOnly) where.isActive = true;

    const packages = await prisma.package.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { userPackages: true },
        },
      },
    });

    return NextResponse.json(packages);
  } catch (error) {
    console.error('Admin packages list error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/admin/packages - Create a new package
export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json();
    const {
      name,
      machineType,
      ballType,
      wicketType,
      timingType,
      totalSessions,
      validityDays = 30,
      price,
      extraChargeRules,
    } = body;

    if (!name || !machineType || !timingType || !totalSessions || !price) {
      return NextResponse.json({ error: 'Missing required fields: name, machineType, timingType, totalSessions, price' }, { status: 400 });
    }

    if (!['LEATHER', 'TENNIS'].includes(machineType)) {
      return NextResponse.json({ error: 'Invalid machineType' }, { status: 400 });
    }
    if (!['DAY', 'EVENING', 'BOTH'].includes(timingType)) {
      return NextResponse.json({ error: 'Invalid timingType' }, { status: 400 });
    }
    if (ballType && !['MACHINE', 'LEATHER', 'BOTH'].includes(ballType)) {
      return NextResponse.json({ error: 'Invalid ballType' }, { status: 400 });
    }
    if (wicketType && !['CEMENT', 'ASTRO', 'BOTH'].includes(wicketType)) {
      return NextResponse.json({ error: 'Invalid wicketType' }, { status: 400 });
    }

    const pkg = await prisma.package.create({
      data: {
        name,
        machineType,
        ballType: ballType || null,
        wicketType: wicketType || null,
        timingType,
        totalSessions,
        validityDays,
        price,
        extraChargeRules: extraChargeRules || null,
      },
    });

    return NextResponse.json(pkg, { status: 201 });
  } catch (error) {
    console.error('Admin create package error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PUT /api/admin/packages - Update a package
export async function PUT(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json();
    const { id, ...updateData } = body;

    if (!id) {
      return NextResponse.json({ error: 'Package id is required' }, { status: 400 });
    }

    const existing = await prisma.package.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Package not found' }, { status: 404 });
    }

    // Only allow updating specific fields
    const allowedFields = ['name', 'machineType', 'ballType', 'wicketType', 'timingType', 'totalSessions', 'validityDays', 'price', 'extraChargeRules', 'isActive'];
    const data: any = {};
    for (const field of allowedFields) {
      if (updateData[field] !== undefined) {
        data[field] = updateData[field];
      }
    }

    const updated = await prisma.package.update({
      where: { id },
      data,
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Admin update package error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
