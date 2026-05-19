import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';
import { resolveCurrentCenter } from '@/lib/centers';
import { getEnabledBookingCategories } from '@/lib/pitch-config';

// GET /api/packages - List available packages at the current center (public)
//
// Returns `{ packages, enabledCategories, bookingModel }`. The
// `enabledCategories` array is the center's `ENABLED_BOOKING_CATEGORIES`
// policy — the same list that drives the user-facing slot picker — so
// the packages page can render its category filter as the intersection
// of the fixed booking-category list and what this center actually
// supports.
export async function GET(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    const center = await resolveCurrentCenter(req, user);
    if (!center) {
      return NextResponse.json({ error: 'No center available' }, { status: 503 });
    }

    const [packages, enabledCategories] = await Promise.all([
      prisma.package.findMany({
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
          // Resource-based (Toplay) fields. Null on legacy ABCA packages;
          // populated on category-targeted packages so the user page can
          // surface the right chip/filter.
          category: true,
          machineRowId: true,
          machineRow: {
            select: {
              id: true,
              name: true,
              shortName: true,
              machineType: { select: { code: true, name: true } },
            },
          },
        },
      }),
      getEnabledBookingCategories(center.id),
    ]);

    return NextResponse.json({
      packages,
      enabledCategories,
      bookingModel: center.bookingModel,
    });
  } catch (error) {
    console.error('List packages error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
