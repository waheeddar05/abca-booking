import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSuperAdmin } from '@/lib/adminAuth';
import { z } from 'zod';

/**
 * GET    /api/admin/centers/[id]   Fetch one center (full detail).
 * PATCH  /api/admin/centers/[id]   Update center fields.
 * DELETE /api/admin/centers/[id]   Soft-delete (isActive = false).
 *
 * Hard-delete is intentionally NOT supported — every center has FK chains
 * (bookings, payments, etc.) and dropping a row would orphan financial
 * records. Use the soft-delete flag and exclude inactive centers from
 * user-facing lists.
 */

const CenterPatchSchema = z.object({
  // slug is intentionally NOT editable post-creation: it's referenced in
  // cookies, bookmarks, and analytics. Create a new center instead.
  name: z.string().min(1).max(120).optional(),
  shortName: z.string().max(40).optional().nullable(),
  description: z.string().max(500).optional().nullable(),
  bookingModel: z.enum(['MACHINE_PITCH', 'RESOURCE_BASED']).optional(),
  isActive: z.boolean().optional(),
  displayOrder: z.number().int().optional(),

  addressLine1: z.string().max(200).optional().nullable(),
  addressLine2: z.string().max(200).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  state: z.string().max(100).optional().nullable(),
  pincode: z.string().max(20).optional().nullable(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  contactPhone: z.string().max(40).optional().nullable(),
  contactEmail: z.string().email().max(200).optional().nullable().or(z.literal('')),
  mapUrl: z.string().url().max(500).optional().nullable().or(z.literal('')),
  logoUrl: z.string().url().max(500).optional().nullable().or(z.literal('')),
  themeColor: z.string().max(20).optional().nullable(),

  // Razorpay — pass empty string to clear, pass non-empty to set.
  razorpayKeyId: z.string().max(200).optional().nullable(),
  razorpayKeySecret: z.string().max(500).optional().nullable(),
  razorpayWebhookSecret: z.string().max(500).optional().nullable(),
});

type Params = { id: string };

export async function GET(req: NextRequest, ctx: { params: Promise<Params> }) {
  const session = await requireSuperAdmin(req);
  if (!session) return NextResponse.json({ error: 'Super admin required' }, { status: 403 });

  const { id } = await ctx.params;
  const center = await prisma.center.findUnique({
    where: { id },
    include: {
      _count: {
        select: {
          memberships: { where: { isActive: true } },
          machines: { where: { isActive: true } },
          resources: { where: { isActive: true } },
          bookings: true,
        },
      },
    },
  });
  if (!center) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Mask secrets in GET responses too.
  return NextResponse.json({
    ...center,
    razorpayKeySecret: center.razorpayKeySecret ? '••••' + center.razorpayKeySecret.slice(-4) : null,
    razorpayWebhookSecret: center.razorpayWebhookSecret
      ? '••••' + center.razorpayWebhookSecret.slice(-4)
      : null,
  });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<Params> }) {
  const session = await requireSuperAdmin(req);
  if (!session) return NextResponse.json({ error: 'Super admin required' }, { status: 403 });

  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = CenterPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // Normalize empty strings → null for the nullable fields.
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed.data)) {
    data[key] = value === '' ? null : value;
  }

  const updated = await prisma.center.update({
    where: { id },
    data,
  });

  return NextResponse.json({
    ...updated,
    razorpayKeySecret: updated.razorpayKeySecret ? '••••' + updated.razorpayKeySecret.slice(-4) : null,
    razorpayWebhookSecret: updated.razorpayWebhookSecret
      ? '••••' + updated.razorpayWebhookSecret.slice(-4)
      : null,
  });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<Params> }) {
  const session = await requireSuperAdmin(req);
  if (!session) return NextResponse.json({ error: 'Super admin required' }, { status: 403 });

  const { id } = await ctx.params;

  // Refuse to soft-delete the last active center — this would lock every
  // user out and break all of `/api/wallet`, `/api/slots/book`, etc.
  const activeCount = await prisma.center.count({ where: { isActive: true } });
  const target = await prisma.center.findUnique({ where: { id } });
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (target.isActive && activeCount <= 1) {
    return NextResponse.json(
      { error: 'Cannot deactivate the only active center' },
      { status: 400 },
    );
  }

  const updated = await prisma.center.update({
    where: { id },
    data: { isActive: false },
  });
  return NextResponse.json({ id: updated.id, isActive: updated.isActive });
}
