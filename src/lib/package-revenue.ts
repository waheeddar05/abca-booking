// Pure (no-Prisma) revenue helper so it can be imported on both the server
// (admin stats + bookings API) and the client (admin Bookings page) without
// dragging the Prisma client into a browser bundle.

/** Minimal shape of a PackageBooking needed to value a redeemed session. */
export interface PackageRevenueInput {
  sessionsUsed?: number | null;
  extraCharge?: number | null;
  userPackage?: {
    amountPaid?: number | null;
    totalSessions?: number | null;
  } | null;
}

/**
 * Revenue recognised from a single package-redeemed booking — i.e. one row in
 * the admin Bookings list whose session was paid for via a package.
 *
 * A package's purchase price (`amountPaid`) is spread evenly across its
 * `totalSessions`, so each redeemed session is worth `amountPaid / totalSessions`
 * times the sessions this booking consumed, plus any per-booking extra charge
 * (ball/pitch/timing/machine upgrade) and the optional kit-rental add-on.
 *
 * This mirrors the dashboard stats calculation so the Bookings page revenue
 * total and the dashboard's revenue figures agree to the rupee.
 */
export function packageSessionRevenue(
  pb: PackageRevenueInput | null | undefined,
  kitRentalCharge: number | null = 0,
): number {
  if (!pb) return 0;
  const total = pb.userPackage?.totalSessions || 0;
  const amountPaid = pb.userPackage?.amountPaid || 0;
  const perSession = total > 0 ? amountPaid / total : 0;
  return perSession * (pb.sessionsUsed || 1) + (pb.extraCharge || 0) + (kitRentalCharge || 0);
}
