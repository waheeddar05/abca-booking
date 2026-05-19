'use client';

import { format } from 'date-fns';
import { IndianRupee, Calendar, Clock, User, Phone, Headset, MapPin } from 'lucide-react';
import { getDisplayStatus } from '@/lib/booking-utils';

// ─── Types ───────────────────────────────────────────────

interface BookingCardProps {
  booking: any;
  role: 'admin' | 'user' | 'operator';
  /** Admin-only: render custom action buttons */
  renderActions?: (booking: any) => React.ReactNode;
  /** Admin-only: render price section (editable) */
  renderPrice?: (booking: any) => React.ReactNode;
  /** Admin-only: render operator assignment dropdown */
  renderOperatorAssignment?: (booking: any) => React.ReactNode;
}

// ─── Status Config ───────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  BOOKED: { label: 'Upcoming', bg: 'bg-green-500/10', text: 'text-green-400', dot: 'bg-green-500' },
  IN_PROGRESS: { label: 'In Progress', bg: 'bg-emerald-500/10', text: 'text-emerald-400', dot: 'bg-emerald-500 animate-pulse' },
  DONE: { label: 'Completed', bg: 'bg-blue-500/10', text: 'text-blue-400', dot: 'bg-blue-500' },
  CANCELLED: { label: 'Cancelled', bg: 'bg-white/[0.04]', text: 'text-slate-400', dot: 'bg-gray-400' },
};

// ─── Helpers ─────────────────────────────────────────────

function getMachineLabel(machineId: string | null): string | null {
  if (!machineId) return null;
  const labels: Record<string, string> = {
    GRAVITY: 'Gravity',
    YANTRA: 'Yantra',
    LEVERAGE_INDOOR: 'Leverage Tennis (In)',
    LEVERAGE_OUTDOOR: 'Leverage Tennis (Out)',
  };
  return labels[machineId] || machineId;
}

function getRefundBadge(booking: any) {
  const refunds = booking.refunds || [];
  if (refunds.length === 0) return null;
  const activeRefunds = refunds.filter((r: any) => r.status !== 'FAILED');
  const totalRefunded = activeRefunds.reduce((sum: number, r: any) => sum + r.amount, 0);
  if (totalRefunded <= 0) return null;
  const hasInitiated = activeRefunds.some((r: any) => r.status === 'INITIATED');
  if (hasInitiated && totalRefunded < (booking.price || Infinity)) {
    return { label: 'Refund Initiated', bg: 'bg-blue-500/10', text: 'text-blue-400' };
  }
  if (totalRefunded >= (booking.price || 0) && booking.price) {
    return { label: 'Refunded', bg: 'bg-green-500/10', text: 'text-green-400' };
  }
  return { label: 'Partially Refunded', bg: 'bg-yellow-500/10', text: 'text-yellow-400' };
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
}

// ─── Component ───────────────────────────────────────────

export function BookingCard({ booking, role, renderActions, renderPrice, renderOperatorAssignment }: BookingCardProps) {
  const displayStatus = getDisplayStatus(booking);
  const status = STATUS_CONFIG[displayStatus] || STATUS_CONFIG.BOOKED;
  const refundBadge = getRefundBadge(booking);

  // Determine customer info based on role
  const customerName = booking.playerName || booking.user?.name || booking.customerName || 'Unknown';
  const customerContact = booking.user?.mobileNumber || booking.user?.email || booking.customerMobile || booking.customerEmail || null;

  // Package info (admin has nested packageBooking, user/operator have isPackageBooking)
  const packageName = booking.packageBooking?.userPackage?.package?.name || booking.packageName || null;
  const isPackageBooking = booking.isPackageBooking || !!booking.packageBooking;

  return (
    <div className="bg-white/[0.03] backdrop-blur-sm rounded-xl border border-white/[0.07] p-3 hover:border-white/[0.12] transition-colors">
      {/* Row 1: Name + Status */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-sm text-white truncate">{customerName}</div>
          {/* Show contact info for admin/operator */}
          {(role === 'admin' || role === 'operator') && customerContact && (
            <div className="text-[10px] text-slate-400 mt-0.5 truncate">
              {role === 'admin' && booking.createdBy ? `By: ${booking.createdBy}` : (
                <a href={`tel:${customerContact}`} className="hover:text-accent transition-colors">
                  {customerContact}
                </a>
              )}
            </div>
          )}
          {booking.status === 'CANCELLED' && booking.cancelledBy && (
            <div className="text-[10px] text-red-400/80 mt-0.5 italic truncate">
              Cancelled by: {booking.cancelledBy}
            </div>
          )}
          {booking.status === 'CANCELLED' && booking.cancellationReason && (
            <div className="text-[10px] text-slate-500 mt-0.5 italic truncate">
              {booking.cancellationReason}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${status.bg} ${status.text}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`}></span>
            {status.label}
          </div>
          {refundBadge && (
            <span className={`inline-flex px-2 py-0.5 rounded-full text-[9px] font-semibold ${refundBadge.bg} ${refundBadge.text}`}>
              {refundBadge.label}
            </span>
          )}
        </div>
      </div>

      {/* Row 2: Date + Time + Price */}
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="flex items-center gap-1.5">
            <Calendar className="w-3 h-3 text-slate-500" />
            <span className="text-xs text-slate-400">{format(new Date(booking.date), 'EEE, MMM d')}</span>
            <Clock className="w-3 h-3 text-slate-500 ml-1" />
            <span className="text-xs text-white">
              {formatTime(booking.startTime)} - {formatTime(booking.endTime)}
            </span>
          </div>
          {booking.createdAt && (
            <div className="text-[9px] text-slate-500 mt-0.5">
              Created: {format(new Date(booking.createdAt), 'MMM d, h:mm a')}
            </div>
          )}
        </div>
        {/* Price section */}
        {renderPrice ? renderPrice(booking) : (
          booking.price != null && !isPackageBooking && (
            <div className="flex items-center gap-1">
              <IndianRupee className="w-3 h-3 text-slate-400" />
              <span className="text-xs font-medium text-white">{booking.price}</span>
              {booking.originalPrice && booking.originalPrice > booking.price && (
                <span className="text-[10px] text-slate-500 line-through ml-0.5">₹{booking.originalPrice}</span>
              )}
              {booking.extraCharge > 0 && (
                <span className="text-[10px] text-amber-400 ml-0.5">+₹{booking.extraCharge}</span>
              )}
            </div>
          )
        )}
      </div>

      {/* Center info — name + city + map + phone. Hidden when the
          booking doesn't carry a center snapshot (legacy rows or admin
          views that don't include the join). The map link opens in a
          new tab; the phone is a tel: link. */}
      {booking.center && (
        <div className="mb-2 bg-white/[0.02] rounded-lg px-2.5 py-1.5 border border-white/[0.04]">
          <div className="flex items-center gap-1.5 min-w-0">
            <MapPin className="w-3 h-3 text-accent/70 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold text-white truncate">
                {booking.center.shortName || booking.center.name}
              </div>
              {(booking.center.addressLine1 || booking.center.city) && (
                <div className="text-[10px] text-slate-400 truncate">
                  {[booking.center.addressLine1, booking.center.city].filter(Boolean).join(', ')}
                </div>
              )}
            </div>
            {/* Map + Call action buttons. Previously they were two
                anchor tags side-by-side with only the parent flex
                container's `gap-1.5` between them — too tight, users
                reported accidental taps. Each is now its own padded
                pill with explicit ml-1 between them and a larger tap
                target. */}
            {booking.center.mapUrl && (
              <a
                href={booking.center.mapUrl}
                target="_blank"
                rel="noreferrer"
                className="ml-1 inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium text-accent bg-accent/10 hover:bg-accent/20 active:scale-95 flex-shrink-0"
              >
                <MapPin className="w-2.5 h-2.5" /> Map
              </a>
            )}
            {booking.center.contactPhone && (
              <a
                href={`tel:${booking.center.contactPhone}`}
                className="ml-1.5 inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium text-accent bg-accent/10 hover:bg-accent/20 active:scale-95 flex-shrink-0"
              >
                <Phone className="w-2.5 h-2.5" /> Call
              </a>
            )}
          </div>
        </div>
      )}

      {/* Row 3: Tags
          Resource-based bookings store TENNIS/WITH_OPERATOR as
          placeholders for the columns the schema can't null out
          (machineType, operationMode). Those placeholders are
          meaningless for NET / SIDEARM / COACHING / FULL_COURT /
          CORPORATE_BATCH bookings — surfacing them as chips ("TENNIS"
          on a sidearm session, "Operator" on a bare-net booking)
          was actively misleading. Show ball / machine label / operator
          chips only for MACHINE bookings; the others get just the
          category chip + the assigned-coach/staff/machine names. */}
      <div className="flex flex-wrap items-center gap-1 mb-2">
        {/* Default category for ABCA rows is null/MACHINE — treat
            both as MACHINE so legacy bookings keep their chips. */}
        {(!booking.category || booking.category === 'MACHINE') && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
            booking.ballType === 'LEATHER' ? 'bg-red-500/10 text-red-400' :
            booking.ballType === 'TENNIS' ? 'bg-green-500/10 text-green-400' :
            'bg-blue-500/10 text-blue-400'
          }`}>
            {booking.ballType}
          </span>
        )}
        {booking.machineId && (!booking.category || booking.category === 'MACHINE') && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.04] text-slate-400 font-medium">
            {getMachineLabel(booking.machineId)}
          </span>
        )}
        {/* Pitch chip — meaningful for MACHINE / SIDEARM / NET.
            FULL_COURT spans every net so pitch isn't a property of
            the booking; COACHING / CORPORATE_BATCH don't pin a pitch. */}
        {booking.pitchType && (
          !booking.category
          || booking.category === 'MACHINE'
          || booking.category === 'SIDEARM'
          || booking.category === 'NET'
        ) && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.04] text-slate-400 font-medium">
            {booking.pitchType === 'ASTRO' ? 'Astro' : booking.pitchType === 'CEMENT' ? 'Cement' : 'Natural'}
          </span>
        )}
        {/* Resource-based booking chips. Hidden on ABCA rows (category
            defaults to MACHINE everywhere) — only render the category
            tag for non-MACHINE categories. Coach/staff name is
            surfaced as a chip so the staff dashboard reads consistently
            with the user-side selection. */}
        {booking.category && booking.category !== 'MACHINE' && (
          <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-indigo-500/10 text-indigo-300">
            {booking.category === 'SIDEARM' ? 'Sidearm'
              : booking.category === 'COACHING' ? 'Coaching'
              : booking.category === 'FULL_COURT' ? 'Full Court'
              : booking.category === 'CORPORATE_BATCH' ? 'Corporate'
              : booking.category === 'NET' ? 'Net only'
              : booking.category}
          </span>
        )}
        {booking.assignedMachineName && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.04] text-slate-400 font-medium">
            {booking.assignedMachineName}
          </span>
        )}
        {booking.assignedCoachName && (
          <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-amber-500/10 text-amber-300">
            Coach: {booking.assignedCoachName}
          </span>
        )}
        {booking.assignedStaffName && (
          <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-cyan-500/10 text-cyan-300">
            Staff: {booking.assignedStaffName}
          </span>
        )}
        {/* Operator chip — only MACHINE bookings actually have a
            with-operator vs self-operate concept. NET / COACHING /
            SIDEARM / FULL_COURT / CORPORATE_BATCH store the column as
            'WITH_OPERATOR' as a placeholder; rendering it as a chip
            implied those sessions have a machine operator, which they
            don't (coach / staff are surfaced separately above). */}
        {booking.operationMode && (!booking.category || booking.category === 'MACHINE') && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
            booking.operationMode === 'SELF_OPERATE' ? 'bg-orange-500/10 text-orange-400' : 'bg-blue-500/10 text-blue-400'
          }`}>
            {booking.operationMode === 'SELF_OPERATE' ? 'Self' : 'Operator'}
          </span>
        )}
        {booking.kitRental && (
          <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-teal-500/10 text-teal-400">
            Cricket Kit{booking.kitRentalCharge ? ` (₹${booking.kitRentalCharge})` : ''}
          </span>
        )}
        {isPackageBooking && packageName && (
          <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-purple-500/10 text-purple-400">
            Package: {packageName}
          </span>
        )}
        {booking.paymentMethod && (
          <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-white/[0.04] text-slate-500">
            {booking.paymentMethod === 'CASH' ? 'Cash' : booking.paymentMethod === 'WALLET' ? 'Wallet' : 'Online'}
          </span>
        )}
      </div>

      {/* Operator info block — only meaningful for MACHINE bookings.
          NET / SIDEARM / COACHING / FULL_COURT / CORPORATE_BATCH carry
          'WITH_OPERATOR' as a schema-required placeholder; rendering
          "Not assigned" under those rows confused users into thinking
          someone was supposed to be assigned. */}
      {(!booking.category || booking.category === 'MACHINE') && (
        renderOperatorAssignment ? renderOperatorAssignment(booking) : (
          booking.operationMode === 'WITH_OPERATOR' && (
            <div className="flex items-center gap-2 mb-2 bg-white/[0.02] rounded-lg px-2.5 py-1.5 border border-white/[0.04]">
              <Headset className="w-3 h-3 text-accent/60 flex-shrink-0" />
              {(booking.operatorName || booking.operator?.name) ? (
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[11px] text-white truncate">{booking.operatorName || booking.operator?.name}</span>
                  {(booking.operatorMobile || booking.operator?.mobileNumber) && (
                    <a
                      href={`tel:${booking.operatorMobile || booking.operator?.mobileNumber}`}
                      className="flex items-center gap-0.5 text-[10px] text-accent hover:text-accent-light transition-colors flex-shrink-0"
                    >
                      <Phone className="w-2.5 h-2.5" />
                      {booking.operatorMobile || booking.operator?.mobileNumber}
                    </a>
                  )}
                </div>
              ) : (
                <span className="text-[11px] text-slate-500">Not assigned</span>
              )}
            </div>
          )
        )
      )}

      {/* Self Operate indicator — same gate. */}
      {booking.operationMode === 'SELF_OPERATE'
        && (!booking.category || booking.category === 'MACHINE') && (
        <div className="flex items-center gap-2 mb-2 bg-amber-500/5 rounded-lg px-2.5 py-1.5 border border-amber-500/10">
          <Headset className="w-3 h-3 text-amber-400/60 flex-shrink-0" />
          <span className="text-[11px] text-amber-400">Self Operate</span>
        </div>
      )}

      {/* Refund Details (user view shows detailed refund history) */}
      {role === 'user' && booking.refunds && booking.refunds.length > 0 && (
        <div className="mb-2 bg-white/[0.02] rounded-lg px-2.5 py-1.5 border border-white/[0.04]">
          {booking.refunds.filter((r: any) => r.status !== 'FAILED').map((refund: any, idx: number) => (
            <div key={idx} className="flex items-center justify-between text-[10px]">
              <span className="text-slate-400">
                Refund ({refund.method === 'WALLET' ? 'Wallet' : 'Bank'})
              </span>
              <span className="text-green-400 font-medium">₹{refund.amount}</span>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      {renderActions && (
        <div className="flex gap-1.5 pt-2 border-t border-white/[0.04]">
          {renderActions(booking)}
        </div>
      )}
    </div>
  );
}

export { STATUS_CONFIG, getRefundBadge };
