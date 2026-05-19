import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSuperAdmin } from '@/lib/adminAuth';
import { z } from 'zod';

/**
 * Centers — super admin only.
 *
 * GET   /api/admin/centers          List all centers
 * POST  /api/admin/centers          Create a new center
 *
 * Each entry includes counts (memberships / machines / resources) so the
 * list view can show high-level health at a glance.
 */

const CenterCreateSchema = z.object({
  slug: z.string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'Slug must be lowercase letters, digits, hyphens'),
  name: z.string().min(1).max(120),
  shortName: z.string().max(40).optional().nullable(),
  description: z.string().max(500).optional().nullable(),
  bookingModel: z.enum(['MACHINE_PITCH', 'RESOURCE_BASED']).default('MACHINE_PITCH'),
  isActive: z.boolean().default(true),
  displayOrder: z.number().int().optional(),

  addressLine1: z.string().max(200).optional().nullable(),
  addressLine2: z.string().max(200).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  state: z.string().max(100).optional().nullable(),
  pincode: z.string().max(20).optional().nullable(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  contactPhone: z.string().max(40).optional().nullable(),
  contactEmail: z.string().email().max(200).optional().nullable(),
  mapUrl: z.string().url().max(500).optional().nullable(),
  logoUrl: z.string().url().max(500).optional().nullable(),
  themeColor: z.string().max(20).optional().nullable(),

  razorpayKeyId: z.string().max(200).optional().nullable(),
  razorpayKeySecret: z.string().max(500).optional().nullable(),
  razorpayWebhookSecret: z.string().max(500).optional().nullable(),
});

export async function GET(req: NextRequest) {
  const session = await requireSuperAdmin(req);
  if (!session) return NextResponse.json({ error: 'Super admin required' }, { status: 403 });

  const centers = await prisma.center.findMany({
    orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    include: {
      _count: {
        select: {
          // `memberships` here counts CenterMembership ROWS, not distinct
          // users — a person with COACH + SIDEARM_SPECIALIST + OPERATOR
          // at one center counts as 3, which is wrong for the admin
          // "X members" stat. We overwrite this with a distinct-user
          // count below.
          memberships: { where: { isActive: true } },
          machines: { where: { isActive: true } },
          resources: { where: { isActive: true } },
          bookings: true,
        },
      },
    },
  });

  // Distinct-user count per center. One groupBy across every active
  // membership row is cheaper than N per-center queries when the admin
  // has many centers.
  const groups = await prisma.centerMembership.groupBy({
    by: ['centerId', 'userId'],
    where: { isActive: true, centerId: { in: centers.map((c) => c.id) } },
  });
  const distinctUsersByCenter = new Map<string, number>();
  for (const g of groups) {
    distinctUsersByCenter.set(g.centerId, (distinctUsersByCenter.get(g.centerId) ?? 0) + 1);
  }

  // Mask Razorpay secrets — only return the last 4 chars to confirm presence.
  return NextResponse.json(
    centers.map((c) => ({
      ...c,
      _count: {
        ...c._count,
        memberships: distinctUsersByCenter.get(c.id) ?? 0,
      },
      razorpayKeySecret: c.razorpayKeySecret ? '••••' + c.razorpayKeySecret.slice(-4) : null,
      razorpayWebhookSecret: c.razorpayWebhookSecret ? '••••' + c.razorpayWebhookSecret.slice(-4) : null,
    })),
  );
}

export async function POST(req: NextRequest) {
  const session = await requireSuperAdmin(req);
  if (!session) return NextResponse.json({ error: 'Super admin required' }, { status: 403 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = CenterCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // Slug uniqueness pre-check for a friendlier error than the Prisma P2002.
  const existing = await prisma.center.findUnique({ where: { slug: parsed.data.slug } });
  if (existing) {
    return NextResponse.json({ error: `Slug "${parsed.data.slug}" is already taken` }, { status: 409 });
  }

  const created = await prisma.center.create({
    data: {
      ...parsed.data,
      // Empty strings → null so optional URL/email validation isn't tripped on update.
      shortName: parsed.data.shortName || null,
      description: parsed.data.description || null,
    },
  });

  return NextResponse.json(created, { status: 201 });
}
