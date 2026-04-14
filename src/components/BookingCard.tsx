'use client';

import { format } from 'date-fns';
import { IndianRupee, Calendar, Clock, User, Phone, Headset } from 'lucide-react';
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
    GRAVITY: 'Gravity Cricket',
    YANTRA: 'Yantra Premium',
    LEVERAGE_INDOOR: 'Tennis Indoor',
    LEVERAGE_OUTDOOR: 'Tennis Outdoor',
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

      {/* Row 3: Tags */}
      <div className="flex flex-wrap items-center gap-1 mb-2">
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
          booking.ballType === 'LEATHER' ? 'bg-red-500/10 text-red-400' :
          booking.ballType === 'TENNIS' ? 'bg-green-500/10 text-green-400' :
          'bg-blue-500/10 text-blue-400'
        }`}>
          {booking.ballType}
        </span>
        {booking.machineId && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.04] text-slate-400 font-medium">
            {getMachineLabel(booking.machineId)}
          </span>
        )}
        {booking.pitchType && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.04] text-slate-400 font-medium">
            {booking.pitchType === 'ASTRO' ? 'Astro' : booking.pitchType === 'CEMENT' ? 'Cement' : 'Natural'}
          </span>
        )}
        {booking.operationMode && (
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

      {/* Operator Info */}
      {renderOperatorAssignment ? renderOperatorAssignment(booking) : (
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
      )}

      {/* Self Operate indicator for non-operator-required bookings */}
      {booking.operationMode === 'SELF_OPERATE' && (
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
