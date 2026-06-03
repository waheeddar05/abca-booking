'use client';

import { Phone } from 'lucide-react';

// ─── Display labels ──────────────────────────────────────
// Human-readable labels so every booking type reads the same way across
// the admin Bookings view, the staff dashboard and the user My Bookings
// page. ABCA legacy rows have a null category but are bowling-machine
// sessions, so the category fallback is MACHINE.

const CATEGORY_LABELS: Record<string, string> = {
  MACHINE: 'Bowling Machine',
  SIDEARM: 'Sidearm',
  NET: 'Cricket Nets',
  COACHING: 'Personal Coaching',
  FULL_COURT: 'Full Indoor Court',
  CORPORATE_BATCH: 'Corporate Batch',
};

const MACHINE_LABELS: Record<string, string> = {
  GRAVITY: 'Gravity',
  YANTRA: 'Yantra',
  LEVERAGE_INDOOR: 'iWinner (Indoor)',
  LEVERAGE_OUTDOOR: 'iWinner (Outdoor)',
};

const PITCH_LABELS: Record<string, string> = {
  ASTRO: 'Astro Turf',
  CEMENT: 'Cement',
  NATURAL: 'Natural Turf',
};

const BALL_LABELS: Record<string, string> = {
  LEATHER: 'Leather Ball',
  TENNIS: 'Tennis Ball',
  MACHINE: 'Machine Ball',
};

/**
 * Resolve the payment-method label. Handles both API shapes:
 *   - user/operator: flat `paymentMethod` + optional `payment` object
 *   - admin:         `paymentMethod` + optional `payments[]`
 * A mixed wallet+online order reads "Wallet + Online".
 */
function paymentMethodLabel(booking: any): string | null {
  if (booking.isPackageBooking || !!booking.packageBooking) return 'Package';
  const payment = booking.payments?.[0] || booking.payment;
  const meta = (payment?.metadata || {}) as Record<string, unknown>;
  const walletPortion = typeof meta.walletDeduction === 'number' ? (meta.walletDeduction as number) : 0;
  const onlinePortion = payment?.amount || 0;
  if (walletPortion > 0 && onlinePortion > 0) return 'Wallet + Online';
  if (booking.paymentMethod === 'WALLET' || walletPortion > 0) return 'Wallet';
  if (booking.paymentMethod === 'CASH') return 'Cash';
  if (booking.paymentMethod === 'ONLINE') return 'Online';
  return booking.paymentMethod || null;
}

interface BookingDetailsListProps {
  booking: any;
  /** user/operator view — assigned-person rows render a tel: call link. */
  showContact?: boolean;
  /** Admin: replaces the Operator value with a reassignment control. */
  renderOperatorAssignment?: (booking: any) => React.ReactNode;
  /** Admin: replaces the Sidearm Specialist value with a reassignment control. */
  renderStaffAssignment?: (booking: any) => React.ReactNode;
  className?: string;
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1 border-b border-white/[0.04] last:border-0">
      <span className="text-[11px] text-slate-400 flex-shrink-0">{label}</span>
      <div className="text-[11px] font-medium text-white text-right min-w-0 flex items-center justify-end gap-1.5">
        {children}
      </div>
    </div>
  );
}

function PersonValue({
  name,
  mobile,
  showContact,
  fallback,
}: {
  name: string | null;
  mobile?: string | null;
  showContact?: boolean;
  fallback?: string;
}) {
  if (!name) return <span className="text-slate-500 font-normal">{fallback || 'Not assigned'}</span>;
  return (
    <>
      <span className="text-white truncate">{name}</span>
      {showContact && mobile && (
        <a
          href={`tel:${mobile}`}
          className="inline-flex items-center gap-0.5 text-accent hover:text-accent-light flex-shrink-0"
        >
          <Phone className="w-2.5 h-2.5" />
        </a>
      )}
    </>
  );
}

/**
 * Standardized labeled booking-detail list, rendered in the same order for
 * every booking category:
 *   Booking Category → Machine Type → Pitch Type → Ball Type →
 *   Operation Mode → Assigned Person (Sidearm Specialist / Operator /
 *   Coach / Ground Staff) → Payment Method → Package Name.
 * Rows that don't apply to a category are simply omitted. The admin view
 * injects reassignment <select>s for the operator / sidearm rows via the
 * render-prop hooks; everywhere else the rows are read-only (with a call
 * link when a mobile number is present).
 */
export function BookingDetailsList({
  booking,
  showContact,
  renderOperatorAssignment,
  renderStaffAssignment,
  className,
}: BookingDetailsListProps) {
  const category: string = booking.category || 'MACHINE';
  const isMachine = category === 'MACHINE';

  const machineLabel = isMachine
    ? booking.machineId
      ? MACHINE_LABELS[booking.machineId] || booking.machineId
      : booking.assignedMachineName || booking.assignedMachine?.shortName || booking.assignedMachine?.name || null
    : null;

  const pitchLabel = booking.pitchType ? PITCH_LABELS[booking.pitchType] || booking.pitchType : null;
  const showPitch = !!pitchLabel && (isMachine || category === 'SIDEARM' || category === 'NET');

  const ballLabel = isMachine && booking.ballType ? BALL_LABELS[booking.ballType] || booking.ballType : null;

  const operationLabel =
    isMachine && booking.operationMode
      ? booking.operationMode === 'SELF_OPERATE'
        ? 'Self Operate'
        : 'With Operator'
      : null;

  const operatorName = booking.operatorName || booking.operator?.name || null;
  const operatorMobile = booking.operatorMobile || booking.operator?.mobileNumber || null;

  const staffName = booking.assignedStaffName || booking.assignedStaff?.name || null;
  const staffMobile = booking.assignedStaff?.mobileNumber || null;

  const coachName = booking.assignedCoachName || booking.assignedCoach?.name || null;
  const coachMobile = booking.assignedCoach?.mobileNumber || null;

  // Ground staff — flattened on the user API (`center.groundStaff`) and
  // nested on the admin API (`center.memberships[0].user`). Accept both.
  const groundStaff = booking.center?.groundStaff || booking.center?.memberships?.[0]?.user || null;

  const paymentLabel = paymentMethodLabel(booking);
  const isPackage = booking.isPackageBooking || !!booking.packageBooking;
  const packageName = booking.packageBooking?.userPackage?.package?.name || booking.packageName || null;

  // Exactly one assigned-person row per category.
  const showOperatorRow = isMachine && booking.operationMode === 'WITH_OPERATOR';
  const showSidearmRow = category === 'SIDEARM';
  const showCoachRow = category === 'COACHING';
  const showGroundStaffRow = category === 'NET' || category === 'FULL_COURT';

  return (
    <div className={`mb-2 ${className || ''}`}>
      <DetailRow label="Booking Category">{CATEGORY_LABELS[category] || category}</DetailRow>
      {machineLabel && <DetailRow label="Machine Type">{machineLabel}</DetailRow>}
      {showPitch && <DetailRow label="Pitch Type">{pitchLabel}</DetailRow>}
      {ballLabel && <DetailRow label="Ball Type">{ballLabel}</DetailRow>}
      {operationLabel && <DetailRow label="Operation Mode">{operationLabel}</DetailRow>}

      {showSidearmRow && (
        <DetailRow label="Sidearm Specialist">
          {renderStaffAssignment ? (
            renderStaffAssignment(booking)
          ) : (
            <PersonValue name={staffName} mobile={staffMobile} showContact={showContact} />
          )}
        </DetailRow>
      )}
      {showOperatorRow && (
        <DetailRow label="Operator Name">
          {renderOperatorAssignment ? (
            renderOperatorAssignment(booking)
          ) : (
            <PersonValue name={operatorName} mobile={operatorMobile} showContact={showContact} />
          )}
        </DetailRow>
      )}
      {showCoachRow && (
        <DetailRow label="Coach Name">
          <PersonValue name={coachName} mobile={coachMobile} showContact={showContact} />
        </DetailRow>
      )}
      {showGroundStaffRow && groundStaff && (
        <DetailRow label="Ground Staff">
          <PersonValue
            name={groundStaff.name || 'Available on-site'}
            mobile={groundStaff.mobileNumber}
            showContact={showContact}
          />
        </DetailRow>
      )}

      {paymentLabel && <DetailRow label="Payment Method">{paymentLabel}</DetailRow>}
      {isPackage && packageName && <DetailRow label="Package Name">{packageName}</DetailRow>}
      {booking.kitRental && (
        <DetailRow label="Cricket Kit">{booking.kitRentalCharge ? `₹${booking.kitRentalCharge}` : 'Included'}</DetailRow>
      )}
    </div>
  );
}
