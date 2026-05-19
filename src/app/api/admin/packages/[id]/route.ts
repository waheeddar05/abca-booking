import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireCenterAdmin } from '@/lib/adminAuth';

// DELETE /api/admin/packages/[id]
//
// Removes a package from the admin's current center. If the package
// has never been purchased (no `UserPackage` rows) we hard-delete the
// row outright. Otherwise we soft-delete by flipping `isActive = false`
// so the package disappears from the user-side browse list while every
// existing UserPackage / PackageBooking it spawned keeps working.
//
// Responds with `{ deleted: true, mode: 'hard' | 'soft' }` so the
// caller can show the appropriate toast.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCenterAdmin(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { id } = await params;

    const existing = await prisma.package.findUnique({
      where: { id },
      include: { _count: { select: { userPackages: true } } },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Package not found' }, { status: 404 });
    }

    // Scope: a center admin can only delete a package that belongs to
    // their currently-resolved center. Super admins still have to
    // operate within the resolved center (`requireCenterAdmin` resolves
    // their cookie/membership), so the same check applies to them.
    if (existing.centerId !== session.center.id) {
      return NextResponse.json({ error: 'Package not found' }, { status: 404 });
    }

    const purchasedCount = existing._count.userPackages;

    if (purchasedCount === 0) {
      await prisma.package.delete({ where: { id } });
      return NextResponse.json({ deleted: true, mode: 'hard' });
    }

    await prisma.package.update({
      where: { id },
      data: { isActive: false },
    });
    return NextResponse.json({ deleted: true, mode: 'soft' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('Delete package error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
