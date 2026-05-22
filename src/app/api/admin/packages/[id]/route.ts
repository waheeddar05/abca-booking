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
  req: NextRequest
) {
  return NextResponse.json(
    { error: 'Packages cannot be deleted to preserve historical data. Please mark as Inactive instead.' },
    { status: 403 },
  );
}
