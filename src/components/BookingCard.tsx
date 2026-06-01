'use client';

import { format } from 'date-fns';
import { IndianRupee, Calendar, Clock, Phone, MapPin } from 'lucide-react';
import { getDisplayStatus } from '@/lib/booking-utils';
import { BookingDetails } from '@/components/BookingDetails';

// ─── Types ───────────────────────────────────────────────

interface BookingCardProps {
  booking: any;
  role: 'admin' | 'user' | 'operator';
  /** Admin-only: render custom action buttons */
  renderActions?: (booking: any) => React.ReactNode;
  /** Admin-only: render price section (editable) */
  renderPrice?: (booking: any) => React.ReactNode;
}

// ─── Status Config ───────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  BOOKED: { label: 'Upcoming', bg: 'bg-green-500/10', text: 'text-green-400', dot: 'bg-green-500' },
  IN_PROGRESS: { label: 'In Progress', bg: 'bg-emerald-500/10', text: 'text-emerald-400', dot: 'bg-emerald-500 animate-pulse' },
  DONE: { label: 'Completed', bg: 'bg-blue-500/10', text: 'text-blue-400', dot: 'bg-blue-500' },
  CANCELLED: { label: 'Cancelled', bg: 'bg-white/[0.04]', text: 'text-slate-400', dot: 'bg-gray-400' },
};

// ─── Helpers ─────────────────────────────────────────────

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

export function BookingCard({ booking, role, renderActions, renderPrice }: BookingCardProps) {
  const displayStatus = getDisplayStatus(booking);
  const status = STATUS_CONFIG[displayStatus] || STATUS_CONFIG.BOOKED;
  const refundBadge = getRefundBadge(booking);

  // Determine customer info based on role
  const customerName = booking.playerName || booking.user?.name || booking.customerName || 'Unknown';
  const customerContact = booking.user?.mobileNumber || booking.user?.email || booking.customerMobile || booking.customerEmail || null;

  // Package info (admin has nested packageBooking, user/operator have isPackageBooking)
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

      {/* Standardized labeled detail rows — same order and labels
          everywhere (Booking Category → Machine Type → Pitch Type →
          Ball Type → Operation Mode → Assigned Person → Payment Method
          → Package Name). Shared with the admin Bookings list so the two
          surfaces never drift. */}
      <BookingDetails booking={booking} role={role} />

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
