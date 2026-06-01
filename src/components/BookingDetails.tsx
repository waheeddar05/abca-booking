'use client';

import { Phone } from 'lucide-react';

/**
 * Standardized booking-detail list.
 *
 * Renders the booking's attributes as labeled label/value rows in a
 * fixed, consistent order so every booking category reads the same way
 * across the User "My Bookings" page, the admin Bookings list, and the
 * staff/operator views:
 *
 *   1. Booking Category
 *   2. Machine Type
 *   3. Pitch Type
 *   4. Ball Type
 *   5. Operation Mode
 *   6. Assigned Person  (Sidearm Specialist / Operator / Coach / Ground Staff)
 *   7. Payment Method
 *   8. Package Name
 *   (+ Kit Rental when present)
 *
 * Only rows that apply to the booking are rendered — e.g. ball type and
 * operation mode are bowling-machine-only concepts, so they're omitted
 * for Sidearm / Cricket Nets / Coaching / Full Court sessions.
 *
 * The component reads BOTH the user-API booking shape (flat fields like
 * `operatorName`, `assignedStaffName`, `center.groundStaff`) and the
 * admin-API shape (nested objects like `operator.name`,
 * `assignedStaff.name`, `center.memberships`), so it can be dropped into
 * either surface without a data adapter.
 */

interface BookingDetailsProps {
  booking: any;
  /** Surface the details came from — reserved for surface-specific tweaks. */
  role?: 'admin' | 'user' | 'operator';
  /**
   * Admin-only override for the "Assigned Person" row value. Lets the
   * admin page swap the static name for an interactive reassignment
   * dropdown (operator / sidearm specialist). Return `undefined` to
   * fall back to the default static name for that kind.
   */
  renderAssignment?: (info: {
    kind: AssignmentKind;
    booking: any;
  }) => React.ReactNode | undefined;
}

type AssignmentKind = 'OPERATOR' | 'SIDEARM' | 'COACH' | 'GROUND_STAFF';

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
  LEVERAGE_INDOOR: 'Leverage Tennis (Indoor)',
  LEVERAGE_OUTDOOR: 'Leverage Tennis (Outdoor)',
};

const PITCH_LABELS: Record<string, string> = {
  ASTRO: 'Astro',
  CEMENT: 'Cement',
  NATURAL: 'Natural Turf',
};

const BALL_LABELS: Record<string, string> = {
  LEATHER: 'Leather Ball',
  TENNIS: 'Tennis Ball',
  MACHINE: 'Machine Ball',
};

function machineLabel(booking: any): string | null {
  if (booking.machineId) return MACHINE_LABELS[booking.machineId] || booking.machineId;
  // Resource-based (admin shape: assignedMachine object; user shape: flat name)
  if (booking.assignedMachine) {
    return booking.assignedMachine.name || booking.assignedMachine.shortName || null;
  }
  return booking.assignedMachineFullName || booking.assignedMachineName || null;
}

function paymentMethodLabel(booking: any): string | null {
  if (booking.isPackageBooking || booking.packageBooking) return null; // shown as Package Name row
  const meta = (booking.payment?.metadata || {}) as Record<string, unknown>;
  const walletPortion = typeof meta.walletDeduction === 'number' ? meta.walletDeduction : 0;
  const onlinePortion = typeof booking.payment?.amount === 'number' ? booking.payment.amount : 0;
  if (walletPortion > 0 && onlinePortion > 0) return 'Wallet + Online';
  if (booking.paymentMethod === 'WALLET' || walletPortion > 0) return 'Wallet';
  if (booking.paymentMethod === 'CASH') return 'Cash';
  if (booking.paymentMethod === 'ONLINE') return 'Online';
  return booking.paymentMethod || null;
}

function groundStaffOf(booking: any): { name: string | null; mobileNumber: string | null } | null {
  const gs = booking.center?.groundStaff || booking.center?.memberships?.[0]?.user || null;
  if (!gs) return null;
  return { name: gs.name ?? null, mobileNumber: gs.mobileNumber ?? null };
}

/** Resolve who (if anyone) is the assigned person for this booking. */
function resolveAssignment(booking: any): {
  kind: AssignmentKind;
  label: string;
  name: string | null;
  mobile: string | null;
} | null {
  const category = booking.category || 'MACHINE';
  if (category === 'MACHINE') {
    if (booking.operationMode === 'WITH_OPERATOR') {
      const name = booking.operatorName || booking.operator?.name || null;
      const mobile = booking.operatorMobile || booking.operator?.mobileNumber || null;
      return { kind: 'OPERATOR', label: 'Operator Name', name, mobile };
    }
    return null;
  }
  if (category === 'SIDEARM') {
    return {
      kind: 'SIDEARM',
      label: 'Sidearm Specialist Name',
      name: booking.assignedStaffName || booking.assignedStaff?.name || null,
      mobile: booking.assignedStaff?.mobileNumber || null,
    };
  }
  if (category === 'COACHING') {
    return {
      kind: 'COACH',
      label: 'Coach Name',
      name: booking.assignedCoachName || booking.assignedCoach?.name || null,
      mobile: booking.assignedCoach?.mobileNumber || null,
    };
  }
  if (category === 'NET' || category === 'FULL_COURT') {
    const gs = groundStaffOf(booking);
    return {
      kind: 'GROUND_STAFF',
      label: 'Ground Staff Name',
      name: gs?.name ?? null,
      mobile: gs?.mobileNumber ?? null,
    };
  }
  return null;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1 border-b border-white/[0.04] last:border-0">
      <span className="text-[10px] font-medium text-slate-500 flex-shrink-0">{label}</span>
      <span className="text-[11px] text-white text-right min-w-0 break-words">{children}</span>
    </div>
  );
}

export function BookingDetails({ booking, renderAssignment }: BookingDetailsProps) {
  const category = booking.category || 'MACHINE';
  const isMachine = category === 'MACHINE';
  const isPackage = booking.isPackageBooking || !!booking.packageBooking;
  const packageName =
    booking.packageBooking?.userPackage?.package?.name || booking.packageName || null;

  const rows: Array<{ key: string; label: string; value: React.ReactNode }> = [];

  // 1. Booking Category
  rows.push({
    key: 'category',
    label: 'Booking Category',
    value: CATEGORY_LABELS[category] || category,
  });

  // 2. Machine Type (bowling-machine sessions only)
  const machine = isMachine ? machineLabel(booking) : null;
  if (machine) {
    rows.push({ key: 'machine', label: 'Machine Type', value: machine });
  }

  // 3. Pitch Type (machine / sidearm / nets)
  if (booking.pitchType && (isMachine || category === 'SIDEARM' || category === 'NET')) {
    rows.push({
      key: 'pitch',
      label: 'Pitch Type',
      value: PITCH_LABELS[booking.pitchType] || booking.pitchType,
    });
  }

  // 4. Ball Type (bowling-machine only — placeholder on other categories)
  if (isMachine && booking.ballType) {
    rows.push({
      key: 'ball',
      label: 'Ball Type',
      value: BALL_LABELS[booking.ballType] || booking.ballType,
    });
  }

  // 5. Operation Mode (bowling-machine only)
  if (isMachine && booking.operationMode) {
    rows.push({
      key: 'mode',
      label: 'Operation Mode',
      value: booking.operationMode === 'SELF_OPERATE' ? 'Self Operate' : 'With Operator',
    });
  }

  // 6. Assigned Person (Sidearm Specialist / Operator / Coach / Ground Staff)
  const assignment = resolveAssignment(booking);
  if (assignment) {
    // Admin may override the value with an interactive reassignment control.
    const override = renderAssignment?.({ kind: assignment.kind, booking });
    let value: React.ReactNode;
    if (override !== undefined && override !== null) {
      value = override;
    } else if (assignment.name) {
      value = (
        <span className="inline-flex items-center gap-1.5 justify-end flex-wrap">
          <span>{assignment.name}</span>
          {assignment.mobile && (
            <a
              href={`tel:${assignment.mobile}`}
              className="inline-flex items-center gap-0.5 text-accent hover:text-accent-light"
            >
              <Phone className="w-2.5 h-2.5" />
              {assignment.mobile}
            </a>
          )}
        </span>
      );
    } else {
      value =
        assignment.kind === 'GROUND_STAFF' ? (
          <span className="text-slate-400">Available on-site</span>
        ) : (
          <span className="text-slate-400">Not assigned</span>
        );
    }
    rows.push({ key: 'assigned', label: assignment.label, value });
  }

  // 7. Payment Method
  const payment = paymentMethodLabel(booking);
  if (payment) {
    rows.push({ key: 'payment', label: 'Payment Method', value: payment });
  }

  // 8. Package Name
  if (isPackage && packageName) {
    rows.push({ key: 'package', label: 'Package Name', value: packageName });
  }

  // Extra: Kit Rental (when present)
  if (booking.kitRental) {
    rows.push({
      key: 'kit',
      label: 'Kit Rental',
      value: `Yes${booking.kitRentalCharge ? ` (₹${booking.kitRentalCharge})` : ''}`,
    });
  }

  if (rows.length === 0) return null;

  return (
    <div className="mb-2 bg-white/[0.02] rounded-lg px-2.5 py-1.5 border border-white/[0.04]">
      {rows.map((r) => (
        <Row key={r.key} label={r.label}>
          {r.value}
        </Row>
      ))}
    </div>
  );
}
