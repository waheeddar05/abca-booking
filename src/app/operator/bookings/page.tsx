// Legacy /operator/bookings route — folded into the unified /staff
// dashboard. SSR redirect so even unauthenticated bookmarks bounce
// cleanly through the middleware on their way to /staff.

import { redirect } from 'next/navigation';

export default function LegacyOperatorBookingsRedirect() {
  redirect('/staff');
}
