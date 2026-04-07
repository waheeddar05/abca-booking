import { prisma } from '@/lib/prisma';
import { timeToMinutes } from '@/lib/pricing';

/**
 * Get applicable promotional discount for a given booking
 * Returns the best matching offer (highest discount value)
 * @param userId Optional user ID to check if user is special user (for appliesTo filtering)
 * @param isSpecialUser Optional boolean flag to indicate if user is special (for appliesTo filtering)
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
    // Determine if user is special (if not already provided)
    let userIsSpecial = isSpecialUser;
    if (userIsSpecial === undefined && userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { isSpecialUser: true },
      });
      userIsSpecial = user?.isSpecialUser ?? false;
    }

    // Get all active offers
    const offers = await prisma.promotionalOffer.findMany({
      where: { isActive: true },
    });

    if (offers.length === 0) {
      return null;
    }

    // Convert booking date to IST and extract date components
    const istDate = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const bookingDateISO = istDate.toISOString().split('T')[0]; // YYYY-MM-DD format
    const dayOfWeek = istDate.getDay(); // 0 = Sunday, 6 = Saturday

    // Extract IST time from startTime
    const istTimeStr = startTime.toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    });
    const slotMinutes = timeToMinutes(istTimeStr);

    // Filter applicable offers
    const applicableOffers = offers.filter(offer => {
      // 1. Check appliesTo filter
      if (offer.appliesTo === 'SPECIAL' && !userIsSpecial) {
        return false;
      }

      // 2. Check date range
      const offerStart = new Date(offer.startDate).toISOString().split('T')[0];
      const offerEnd = new Date(offer.endDate).toISOString().split('T')[0];
      if (bookingDateISO < offerStart || bookingDateISO > offerEnd) {
        return false;
      }

      // 3. Check day of week if specified (empty days = all days)
      if (offer.days && offer.days.length > 0) {
        if (!offer.days.includes(dayOfWeek)) {
          return false;
        }
      }

      // 4. Check time slot if specified (null = all day)
      if (offer.timeSlotStart && offer.timeSlotEnd) {
        const slotStart = timeToMinutes(offer.timeSlotStart);
        const slotEnd = timeToMinutes(offer.timeSlotEnd);
        if (slotMinutes < slotStart || slotMinutes >= slotEnd) {
          return false;
        }
      }

      // 5. Check machine ID (null = all machines)
      if (offer.machineId && offer.machineId !== machineId) {
        return false;
      }

      // 6. Check pitch type (null = all pitches)
      if (offer.pitchType && offer.pitchType !== pitchType) {
        return false;
      }

      return true;
    });

    if (applicableOffers.length === 0) {
      return null;
    }

    // Return the offer with the highest discount value
    // (For percentage, this is the highest percentage; for fixed, the highest amount)
    const bestOffer = applicableOffers.reduce((best, current) => {
      return current.discountValue > best.discountValue ? current : best;
    });

    return {
      offerId: bestOffer.id,
      name: bestOffer.name,
      discountType: bestOffer.discountType as 'PERCENTAGE' | 'FIXED',
      discountValue: bestOffer.discountValue,
    };
  } catch (error) {
    console.error('[PromoOffers] Error fetching applicable discount:', error);
    return null;
  }
}
