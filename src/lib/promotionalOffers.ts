import { prisma } from '@/lib/prisma';
import { timeToMinutes } from '@/lib/pricing';
import { type MachineId, type PitchType, type BookingCategory } from '@prisma/client';

interface PromoResult {
  offerId: string;
  name: string;
  discountType: 'PERCENTAGE' | 'FIXED';
  discountValue: number;
  appliesTo: string;
}

/**
 * Get ALL applicable promotional discounts for a given booking slot.
 * Returns all matching offers so the stacking logic can decide what to apply.
 *
 * Targeting rules — for an offer to apply, every non-empty axis on the
 * offer must match the booking's corresponding value. Empty arrays =
 * "no filter on that axis" (offer applies regardless).
 *
 *   Legacy / ABCA: machineIds[] (MachineId enum), pitchTypes[]
 *   RESOURCE_BASED: machineRowIds[] (Machine.id), categories[] (BookingCategory)
 *
 * Both axes can be set on a single offer; the engine evaluates each
 * against the corresponding booking field independently.
 */
export async function getAllApplicablePromoDiscounts(
  date: Date,
  startTime: Date,
  machineId?: string | null,
  pitchType?: string | null,
  isSpecialUser?: boolean,
  // RESOURCE_BASED context — pass these from book-resource so offers
  // targeting Machine row + BookingCategory can apply at Toplay.
  machineRowId?: string | null,
  category?: BookingCategory | null,
  centerId?: string | null,
): Promise<PromoResult[]> {
  try {
    const offers = await prisma.promotionalOffer.findMany({
      where: { isActive: true, ...(centerId ? { centerId } : {}) },
    });

    if (offers.length === 0) {
      return [];
    }

    const istDate = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const bookingDateISO = istDate.toISOString().split('T')[0];
    const dayOfWeek = istDate.getDay();

    const istTimeStr = startTime.toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    });
    const slotMinutes = timeToMinutes(istTimeStr);

    const applicableOffers = offers.filter(offer => {
      // Audience filter:
      //   SPECIAL      → only special users
      //   NON_SPECIAL  → only generic (non-special) users
      //   ALL          → both
      if (offer.appliesTo === 'SPECIAL' && !isSpecialUser) {
        return false;
      }
      if (offer.appliesTo === 'NON_SPECIAL' && isSpecialUser) {
        return false;
      }

      // Check date range
      const offerStart = new Date(offer.startDate).toISOString().split('T')[0];
      const offerEnd = new Date(offer.endDate).toISOString().split('T')[0];
      if (bookingDateISO < offerStart || bookingDateISO > offerEnd) {
        return false;
      }

      // Check day of week
      if (offer.days && offer.days.length > 0) {
        if (!offer.days.includes(dayOfWeek)) {
          return false;
        }
      }

      // Check time slot
      if (offer.timeSlotStart && offer.timeSlotEnd) {
        const slotStart = timeToMinutes(offer.timeSlotStart);
        const slotEnd = timeToMinutes(offer.timeSlotEnd);
        if (slotMinutes < slotStart || slotMinutes >= slotEnd) {
          return false;
        }
      }

      // Check machine IDs (legacy enum) — MACHINE_PITCH centers only
      if (offer.machineIds && offer.machineIds.length > 0 && machineId && !offer.machineIds.includes(machineId as MachineId)) {
        return false;
      }

      // Check pitch types (legacy enum)
      if (offer.pitchTypes && offer.pitchTypes.length > 0 && pitchType && !offer.pitchTypes.includes(pitchType as PitchType)) {
        return false;
      }

      // Check Machine row IDs (RESOURCE_BASED). If the offer targets a
      // specific machine row but the booking didn't supply one (e.g.
      // SIDEARM/COACHING bookings have no machineRowId), the offer
      // doesn't apply — the admin meant a machine-specific offer.
      if (offer.machineRowIds && offer.machineRowIds.length > 0) {
        if (!machineRowId || !offer.machineRowIds.includes(machineRowId)) {
          return false;
        }
      }

      // Check BookingCategory (RESOURCE_BASED). Same logic — non-empty
      // category list on the offer requires a category on the booking.
      if (offer.categories && offer.categories.length > 0) {
        if (!category || !offer.categories.includes(category as BookingCategory)) {
          return false;
        }
      }

      return true;
    });

    return applicableOffers.map(offer => ({
      offerId: offer.id,
      name: offer.name,
      discountType: offer.discountType as 'PERCENTAGE' | 'FIXED',
      discountValue: offer.discountValue,
      appliesTo: offer.appliesTo,
    }));
  } catch (error) {
    console.error('[PromoOffers] Error fetching applicable discounts:', error);
    return [];
  }
}

/**
 * Get the single best applicable promotional discount (legacy interface).
 * Only returns the highest-value offer among ALL-user offers.
 */
export async function getApplicablePromoDiscount(
  date: Date,
  startTime: Date,
  machineId?: string | null,
  pitchType?: string | null,
  userId?: string | null,
  isSpecialUser?: boolean | null,
): Promise<{ offerId: string; name: string; discountType: 'PERCENTAGE' | 'FIXED'; discountValue: number } | null> {
  try {
    let userIsSpecial = isSpecialUser;
    if (userIsSpecial === undefined && userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { isSpecialUser: true },
      });
      userIsSpecial = user?.isSpecialUser ?? false;
    }

    const allOffers = await getAllApplicablePromoDiscounts(
      date, startTime, machineId, pitchType, !!userIsSpecial,
    );

    if (allOffers.length === 0) {
      return null;
    }

    // Return the offer with the highest discount value
    const bestOffer = allOffers.reduce((best, current) => {
      return current.discountValue > best.discountValue ? current : best;
    });

    return {
      offerId: bestOffer.offerId,
      name: bestOffer.name,
      discountType: bestOffer.discountType,
      discountValue: bestOffer.discountValue,
    };
  } catch (error) {
    console.error('[PromoOffers] Error fetching applicable discount:', error);
    return null;
  }
}
