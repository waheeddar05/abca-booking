/**
 * Unified Notification Service
 *
 * Consolidates all notification creation into a single service.
 * Supports IN_APP (database) and WHATSAPP channels.
 *
 * Feature flag: WHATSAPP_NOTIFICATIONS_ENABLED (Policy table)
 *   - 'true'  → sends WhatsApp + in-app
 *   - 'false' / absent → in-app only
 */

import { prisma } from '@/lib/prisma';
import { getCachedPolicy } from '@/lib/policy-cache';
import {
  sendWhatsAppNotification,
  sendWhatsAppText,
  type TemplateComponent,
  type WhatsAppSendResult,
} from '@/lib/whatsapp';
import { formatIST } from '@/lib/time';
import { MACHINES } from '@/lib/constants';
import type { BookingCategory, NotificationChannel, WhatsAppMessageStatus } from '@prisma/client';

// ─── Types ──────────────────────────────────────────────────────────

export interface NotificationPayload {
  userId: string;
  title: string;
  message: string;
  type?: string; // INFO, WARNING, SUCCESS, etc.
  // When this alert is about a specific booking (confirmation /
  // cancellation / refund), the booking id is stored so the in-app
  // Alerts view can render the full Bookings-page card as a snapshot.
  bookingId?: string | null;
}

export interface WhatsAppTemplatePayload {
  mobileNumber: string;
  templateName: string;
  components: TemplateComponent[];
  language?: string;
}

interface SendResult {
  notificationId: string;
  channel: NotificationChannel;
  whatsappResult?: WhatsAppSendResult | null;
}

// ─── Core Functions ─────────────────────────────────────────────────

/**
 * Check if WhatsApp notifications are enabled via feature flag.
 */
async function isWhatsAppEnabled(): Promise<boolean> {
  const val = await getCachedPolicy('WHATSAPP_NOTIFICATIONS_ENABLED');
  return val === 'true';
}

// ─── Center Name Resolution ─────────────────────────────────────────
//
// Every notification names the center it relates to so recipients can
// tell ABCA from Toplay at a glance (multi-center). Callers pass the
// name directly when they already have it (e.g. a loaded `center`
// relation), or just the `centerId` and we look the name up. Center
// names change rarely, so a small module-level cache keeps these
// fire-and-forget paths from doing an extra DB round-trip every time.
// Falls back to 'PlayOrbit' so the WhatsApp template always receives a
// value for its leading parameter (never a param-count mismatch).

const centerNameCache = new Map<string, string>();

async function resolveCenterName(opts: {
  centerName?: string | null;
  centerId?: string | null;
}): Promise<string> {
  const explicit = opts.centerName?.trim();
  if (explicit) return explicit;

  const id = opts.centerId;
  if (id) {
    const cached = centerNameCache.get(id);
    if (cached) return cached;
    try {
      const center = await prisma.center.findUnique({
        where: { id },
        select: { name: true },
      });
      if (center?.name) {
        centerNameCache.set(id, center.name);
        return center.name;
      }
    } catch (err) {
      console.error('[Notifications] Failed to resolve center name:', {
        centerId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return 'PlayOrbit';
}

// ─── booking_detail location parameter (opt-in) ─────────────────────
//
// The approved `booking_detail` template historically ends with a STATIC
// "📍 maps link" baked into the template body — so every center's
// confirmation rendered that one (ABCA) location, even Toplay's. To show
// each center's OWN map, re-approve the template with a trailing {{8}}
// placeholder ("📍 {{8}}") that we fill with the booking center's `mapUrl`.
//
// Gated behind WHATSAPP_BOOKING_DETAIL_LOCATION_ENABLED so the code and the
// BSP template change ship independently: until the template actually has
// {{8}}, sending an 8th param makes Meta reject the whole message. Flip the
// flag to 'true' only AFTER the template is re-approved with {{8}}.
function bookingDetailLocationEnabled(): boolean {
  return process.env.WHATSAPP_BOOKING_DETAIL_LOCATION_ENABLED === 'true';
}

// Center map URLs change rarely, so cache them per id to keep these
// fire-and-forget paths from doing an extra DB round-trip each time.
const centerMapUrlCache = new Map<string, string | null>();

/**
 * Resolve the booking center's map URL. Callers that already loaded the
 * center pass `mapUrl` directly (even `null`); the legacy machine path
 * passes only `centerId` and we look it up (cached). Returns null when the
 * center has no map configured.
 */
async function resolveCenterMapUrl(opts: {
  mapUrl?: string | null;
  centerId?: string | null;
}): Promise<string | null> {
  if (opts.mapUrl !== undefined) return opts.mapUrl?.trim() || null;
  const id = opts.centerId;
  if (!id) return null;
  if (centerMapUrlCache.has(id)) return centerMapUrlCache.get(id) ?? null;
  try {
    const center = await prisma.center.findUnique({ where: { id }, select: { mapUrl: true } });
    const value = center?.mapUrl?.trim() || null;
    centerMapUrlCache.set(id, value);
    return value;
  } catch (err) {
    console.error('[Notifications] Failed to resolve center mapUrl:', {
      centerId: id,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Build the body parameters for the approved `booking_detail` template.
 * Pass the 7 base values in order; when the location placeholder is enabled
 * (template re-approved with a trailing "📍 {{8}}"), the center's map URL is
 * appended as {{8}} so each center shows its OWN location. A non-empty
 * fallback is used when a center has no map configured (Meta rejects empty
 * params).
 */
function buildBookingDetailParams(
  base: [string, string, string, string, string, string, string],
  mapUrl: string | null,
): { type: string; text: string }[] {
  const values: string[] = [...base];
  if (bookingDetailLocationEnabled()) {
    values.push(mapUrl || 'Location shared at the center');
  }
  return values.map((text) => ({ type: 'text', text }));
}

/**
 * Send an in-app notification (always created in DB).
 * Optionally also sends via WhatsApp if the feature is enabled
 * AND the user has a verified mobile number.
 */
export async function notify(
  payload: NotificationPayload,
  whatsappTemplate?: WhatsAppTemplatePayload,
): Promise<SendResult> {
  const { userId, title, message, type = 'INFO', bookingId } = payload;

  let channel: NotificationChannel = 'IN_APP';
  let whatsappResult: WhatsAppSendResult | null = null;
  let whatsappMessageId: string | undefined;
  let whatsappStatus: WhatsAppMessageStatus | undefined;

  // Try to send WhatsApp if template is provided
  if (whatsappTemplate) {
    const waEnabled = await isWhatsAppEnabled();
    if (waEnabled && whatsappTemplate.mobileNumber) {
      whatsappResult = await sendWhatsAppNotification(
        whatsappTemplate.mobileNumber,
        whatsappTemplate.templateName,
        whatsappTemplate.components,
        whatsappTemplate.language,
      );

      if (whatsappResult?.success) {
        channel = 'BOTH';
        whatsappMessageId = whatsappResult.messageId;
        whatsappStatus = 'SENT';
      } else {
        // WhatsApp failed — still create in-app notification
        whatsappStatus = 'FAILED';
      }
    }
  }

  // Always create in-app notification
  const notification = await prisma.notification.create({
    data: {
      userId,
      title,
      message,
      type,
      channel,
      whatsappMessageId,
      whatsappStatus,
      bookingId: bookingId ?? null,
    },
  });

  return {
    notificationId: notification.id,
    channel,
    whatsappResult,
  };
}

// ─── Pre-built Notification Templates ───────────────────────────────

/**
 * Notify user that their booking is confirmed.
 */
export async function notifyBookingConfirmed(
  userId: string,
  details: {
    date: string; // e.g. "Wed, 26 Mar 2026"
    time: string; // e.g. "04:00 PM – 04:30 PM (2 slots)"
    machine: string; // e.g. "Yantra"
    pitch: string; // e.g. "Astro Turf"
    price: string; // e.g. "₹500"
    operatorName?: string; // e.g. "Pratyush"
    operatorPhone?: string; // e.g. "7058683664"
    mobileNumber?: string | null;
    kitRental?: boolean;
    kitRentalCharge?: number | null;
    centerName?: string; // e.g. "ABCA Cricket Academy" — leads the message
    centerId?: string; // looked up when centerName isn't supplied
    mapUrl?: string | null; // the center's own map link — used for {{8}} when the location param is enabled
    // When supplied, the in-app alert renders these "Label: value" rows
    // (admin-Bookings-page parity) instead of the one-line summary. The
    // approved WhatsApp template below is unaffected (still booking_detail).
    detailSegments?: string[];
    // Booking this confirmation is for — lets the Alerts view render the
    // full Bookings-page card snapshot.
    bookingId?: string | null;
  },
): Promise<SendResult> {
  // Template booking_detail. The center name is embedded into the leading
  // {{1}} (date) param so it renders right under the title, e.g.
  // "📅 ABCA • Wed, 26 Mar 2026":
  // "🏏 *Booking Confirmed!*\n📅 {{1}}\n⏰ {{2}}\n🎯 {{3}} — {{4}}\n💰 {{5}}\n👤 Operator: {{6}}\n📞 Contact: {{7}}\n📍 {{8}}"
  // {{8}} (the center's own map link) is sent only when the template has
  // been re-approved with it and WHATSAPP_BOOKING_DETAIL_LOCATION_ENABLED is
  // 'true'; otherwise 7 params are sent (legacy template with a static map).
  const kitInfo = details.kitRental ? ' + Cricket Kit' : '';
  const centerName = await resolveCenterName(details);
  const mapUrl = await resolveCenterMapUrl(details);
  const operatorName = details.operatorName || 'To be assigned';
  const operatorPhone = details.operatorPhone || 'Will be shared soon';

  // In-app alert ("Notifications" view): render the booking as labelled
  // "Label: value" rows so the customer sees the same field set the admin
  // Bookings page shows. Resource-based centers pass category-aware
  // detailSegments (Category / Machine / Pitch / Ball / Operation /
  // assigned person / Payment / Kit); the legacy machine path builds rows
  // from the machine + pitch + operator it already has.
  const inAppSegments = details.detailSegments?.length
    ? [centerName, `Date: ${details.date}`, `Time: ${details.time}`, ...details.detailSegments, `Price: ${details.price}`]
    : [
        centerName,
        `Date: ${details.date}`,
        `Time: ${details.time}`,
        `Machine: ${details.machine}`,
        `Pitch: ${details.pitch}`,
        ...(details.operatorName ? [`Operator: ${details.operatorName}`] : []),
        `Price: ${details.price}${kitInfo}`,
      ];

  return notify(
    {
      userId,
      title: 'Booking Confirmed',
      message: inAppSegments.join(' | '),
      type: 'SUCCESS',
      bookingId: details.bookingId ?? null,
    },
    details.mobileNumber
      ? {
          mobileNumber: details.mobileNumber,
          templateName: 'booking_detail',
          components: [
            {
              type: 'body',
              parameters: buildBookingDetailParams(
                [
                  `${centerName} • ${details.date}`,
                  details.time,
                  details.machine,
                  details.pitch,
                  details.price + kitInfo,
                  operatorName,
                  operatorPhone,
                ],
                mapUrl,
              ),
            },
          ],
        }
      : undefined,
  );
}

/**
 * Notify user that their booking was cancelled.
 */
export async function notifyBookingCancelled(
  userId: string,
  details: {
    message: string;
    mobileNumber?: string | null;
    refundInfo?: string;
    centerName?: string; // leads the message
    centerId?: string; // looked up when centerName isn't supplied
    // Booking this cancellation is for — lets the Alerts view render the
    // full Bookings-page card snapshot (with refund details).
    bookingId?: string | null;
  },
): Promise<SendResult> {
  const centerName = await resolveCenterName(details);
  const fullMessage = details.refundInfo
    ? `${details.message}\n${details.refundInfo}`
    : details.message;

  // Template booking_cancelled (1 param — UNCHANGED on the BSP). The center
  // name leads the {{1}} detail string so it's the first thing the reader
  // sees in the message body:
  // "Your PlayOrbit booking has been cancelled: {{1}}. If a refund applies, it will be credited to your wallet."
  return notify(
    {
      userId,
      title: 'Booking Cancelled',
      message: `${centerName} — ${fullMessage}`,
      type: 'CANCELLATION',
      bookingId: details.bookingId ?? null,
    },
    details.mobileNumber
      ? {
          mobileNumber: details.mobileNumber,
          templateName: 'booking_cancelled',
          components: [
            {
              type: 'body',
              // Meta WhatsApp API rejects newlines, tabs, and 4+ consecutive spaces in template params
              parameters: [
                {
                  type: 'text',
                  text: `${centerName} • ${details.message}`.replace(/[\n\t]/g, ' | ').replace(/\s{4,}/g, '   '),
                },
              ],
            },
          ],
        }
      : undefined,
  );
}

// ─── Shared booking-detail segments (admin Bookings-page parity) ─────
//
// The /notifications "alerts" view (src/app/notifications/page.tsx) splits
// a notification message on " | " / newlines and renders every
// "Label: value" piece as its own labelled row. So when an alert is built
// from these segments it shows the recipient the SAME field rows the admin
// Bookings page renders via <BookingDetailsList> — Category, Machine,
// Pitch, Ball, Operation, the assigned person, Payment, and Cricket Kit.
// Reused by the customer confirmation/cancellation alerts and the staff
// (operator / coach / specialist / ground staff) alerts alike.

const DETAIL_CATEGORY_LABELS: Record<BookingCategory, string> = {
  MACHINE: 'Bowling Machine',
  SIDEARM: 'Sidearm',
  COACHING: 'Personal Coaching',
  NET: 'Cricket Nets',
  FULL_COURT: 'Full Indoor Court',
  CORPORATE_BATCH: 'Corporate Batch',
};

const DETAIL_PITCH_LABELS: Record<string, string> = {
  ASTRO: 'Astro Turf',
  CEMENT: 'Cement',
  NATURAL: 'Natural Turf',
  TURF: 'Cement',
};

const DETAIL_BALL_LABELS: Record<string, string> = {
  LEATHER: 'Leather Ball',
  TENNIS: 'Tennis Ball',
  MACHINE: 'Machine Ball',
};

/** Loaded booking fields needed to render the admin-style detail rows. */
interface BookingDetailFields {
  category: BookingCategory;
  machineId?: string | null;
  assignedMachine?: { name: string; shortName?: string | null; machineType?: { name: string } | null } | null;
  pitchType?: string | null;
  ballType?: string | null;
  operationMode?: string | null;
  operator?: { name: string | null } | null;
  assignedCoach?: { name: string | null } | null;
  assignedStaff?: { name: string | null } | null;
  paymentMethod?: string | null;
  packageBooking?: { id: string } | null;
  kitRental?: boolean | null;
  kitRentalCharge?: number | null;
}

/** Resolve the machine label for a MACHINE booking (legacy enum or Machine row). */
function detailMachineLabel(b: BookingDetailFields): string | null {
  if (b.machineId) {
    return MACHINES[b.machineId as keyof typeof MACHINES]?.shortName || b.machineId;
  }
  if (b.assignedMachine) {
    const typeName = b.assignedMachine.machineType?.name;
    return typeName ? `${b.assignedMachine.name} (${typeName})` : b.assignedMachine.name;
  }
  return null;
}

/** Friendly payment-method label (mirrors the admin Bookings list). */
function detailPaymentLabel(b: BookingDetailFields): string | null {
  if (b.packageBooking) return 'Package';
  switch (b.paymentMethod) {
    case 'WALLET':
      return 'Wallet';
    case 'CASH':
      return 'Cash';
    case 'ONLINE':
      return 'Online';
    default:
      return b.paymentMethod || null;
  }
}

/**
 * Build the admin Bookings-page detail rows for a booking as
 * "Label: value" segments, in the same field order <BookingDetailsList>
 * renders them. Null-safe — a row is omitted whenever its value isn't set,
 * exactly like the admin list. Machine/Ball rows are emitted ONLY for
 * MACHINE bookings, so a non-machine booking can never leak the TENNIS
 * `ballType` default as a bogus "Machine: …" line.
 */
function buildBookingDetailSegments(b: BookingDetailFields): string[] {
  const isMachine = b.category === 'MACHINE';
  const segments: string[] = [`Category: ${DETAIL_CATEGORY_LABELS[b.category] || b.category}`];

  const machineLabel = isMachine ? detailMachineLabel(b) : null;
  if (machineLabel) segments.push(`Machine: ${machineLabel}`);

  if (b.pitchType && (isMachine || b.category === 'SIDEARM' || b.category === 'NET')) {
    segments.push(`Pitch: ${DETAIL_PITCH_LABELS[b.pitchType] || b.pitchType}`);
  }
  if (isMachine && b.ballType) {
    segments.push(`Ball: ${DETAIL_BALL_LABELS[b.ballType] || b.ballType}`);
  }
  if (isMachine && b.operationMode) {
    segments.push(`Operation: ${b.operationMode === 'SELF_OPERATE' ? 'Self Operate' : 'With Operator'}`);
  }

  // Exactly one assigned-person row per category — same as the admin list.
  if (isMachine && b.operationMode === 'WITH_OPERATOR' && b.operator?.name) {
    segments.push(`Operator: ${b.operator.name}`);
  } else if (b.category === 'SIDEARM' && b.assignedStaff?.name) {
    segments.push(`Sidearm Specialist: ${b.assignedStaff.name}`);
  } else if (b.category === 'COACHING' && b.assignedCoach?.name) {
    segments.push(`Coach: ${b.assignedCoach.name}`);
  }

  const payment = detailPaymentLabel(b);
  if (payment) segments.push(`Payment: ${payment}`);

  if (b.kitRental) {
    segments.push(`Cricket Kit: ${b.kitRentalCharge ? `₹${b.kitRentalCharge}` : 'Included'}`);
  }
  return segments;
}

/**
 * Build the "what was booked" detail line(s) for a customer cancellation
 * notification — the full admin-Bookings-page detail set (Category,
 * Machine, Pitch, Ball, Operation, assigned person, Payment, Cricket Kit)
 * so the cancellation alert carries the same details the admin Bookings
 * page shows. Machine/Ball rows stay MACHINE-only, so a Sidearm/Coaching
 * cancellation never renders a bogus "Machine: TENNIS" line.
 *
 * Best-effort: any lookup failure returns an empty array so the
 * cancellation notification still goes out (just without the detail
 * lines). Never throws.
 */
export async function buildCancellationDetailLines(bookingId: string): Promise<string[]> {
  try {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        category: true,
        machineId: true,
        assignedMachine: { select: { name: true, shortName: true, machineType: { select: { name: true } } } },
        pitchType: true,
        ballType: true,
        operationMode: true,
        operator: { select: { name: true } },
        assignedStaff: { select: { name: true } },
        assignedCoach: { select: { name: true } },
        paymentMethod: true,
        packageBooking: { select: { id: true } },
        kitRental: true,
        kitRentalCharge: true,
      },
    });
    if (!booking) return [];
    return buildBookingDetailSegments(booking as BookingDetailFields);
  } catch (err) {
    console.warn('[Notifications] buildCancellationDetailLines failed:', err);
    return [];
  }
}

/**
 * Notify user about a payment/package purchase.
 */
export async function notifyPaymentSuccess(
  userId: string,
  details: {
    message: string;
    mobileNumber?: string | null;
    centerName?: string; // leads the message
    centerId?: string; // looked up when centerName isn't supplied
  },
): Promise<SendResult> {
  const centerName = await resolveCenterName(details);
  // Template payment_success (1 param — UNCHANGED on the BSP). The center
  // name leads the {{1}} message string so it's identifiable up front:
  // "{{1}}"
  return notify(
    {
      userId,
      title: 'Payment Successful',
      message: `${centerName} — ${details.message}`,
      type: 'SUCCESS',
    },
    details.mobileNumber
      ? {
          mobileNumber: details.mobileNumber,
          templateName: 'payment_success',
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: `${centerName} • ${details.message}` },
              ],
            },
          ],
        }
      : undefined,
  );
}

/**
 * Notify user about a wallet credit (refund).
 */
export async function notifyWalletCredit(
  userId: string,
  details: {
    amount: number;
    reason: string;
    newBalance: number;
    mobileNumber?: string | null;
    centerName?: string; // leads the message
    centerId?: string; // looked up when centerName isn't supplied
    // Set when the credit is a booking-cancellation refund — links the
    // alert to the booking so the Alerts view can show the card snapshot.
    bookingId?: string | null;
  },
): Promise<SendResult> {
  const centerName = await resolveCenterName(details);
  // Template wallet_credit (3 params — UNCHANGED on the BSP). The {{1}}
  // (amount) and {{3}} (balance) slots render with a "₹" prefix so they
  // must stay numeric; the center name is folded into the {{2}} reason
  // string instead so it's still named in the message:
  // "PlayOrbit Wallet: ₹{{1}} credited. Reason: {{2}}. New balance: ₹{{3}}. Thank you!"
  const message = `${centerName} — ₹${details.amount} credited to your wallet. Reason: ${details.reason}. Balance: ₹${details.newBalance}`;

  return notify(
    {
      userId,
      title: 'Wallet Credited',
      message,
      type: 'SUCCESS',
      bookingId: details.bookingId ?? null,
    },
    details.mobileNumber
      ? {
          mobileNumber: details.mobileNumber,
          templateName: 'wallet_credit',
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: `${details.amount}` },
                { type: 'text', text: `${centerName} • ${details.reason}` },
                { type: 'text', text: `${details.newBalance}` },
              ],
            },
          ],
        }
      : undefined,
  );
}

/**
 * Send a generic info notification (in-app only).
 */
export async function notifyInfo(
  userId: string,
  title: string,
  message: string,
): Promise<SendResult> {
  return notify({ userId, title, message, type: 'INFO' });
}

// ─── Operator Notification Helpers ─────────────────────────────────

/**
 * Look up the assigned operator for a booking.
 * Returns null only when no operator is assigned. Missing mobile number is
 * fine — the caller can still create an in-app notification and skip WhatsApp.
 */
async function getBookingOperator(
  bookingId: string,
): Promise<{ operatorId: string; name: string; mobileNumber: string | null; centerName: string } | null> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      operatorId: true,
      operator: { select: { id: true, name: true, mobileNumber: true } },
      center: { select: { name: true } },
    },
  });
  if (!booking?.operator) return null;
  return {
    operatorId: booking.operator.id,
    name: booking.operator.name || 'Operator',
    mobileNumber: booking.operator.mobileNumber || null,
    centerName: booking.center?.name || 'PlayOrbit',
  };
}

/**
 * Notify the assigned operator about a new booking via WhatsApp text + in-app.
 * Falls back silently if no operator assigned or WhatsApp not configured.
 */
export async function notifyOperatorNewBooking(
  bookingIds: string[],
  details: {
    customerName: string;
    date: string;
    time: string;
    machine: string;
    pitch: string;
    slotCount: number;
  },
): Promise<void> {
  if (bookingIds.length === 0) return;

  try {
    const operator = await getBookingOperator(bookingIds[0]);
    if (!operator) return;

    const msg = [
      `New Booking!`,
      `Center: ${operator.centerName}`,
      `Customer: ${details.customerName}`,
      `Date: ${details.date}`,
      `Time: ${details.time}`,
      `Machine: ${details.machine}`,
      `Pitch: ${details.pitch}`,
      `Slots: ${details.slotCount}`,
    ].join('\n');

    // In-app notification for the operator
    await notify({
      userId: operator.operatorId,
      title: 'New Booking Assigned',
      message: msg.replace(/\n/g, ' | '),
      type: 'SUCCESS',
    });

    // WhatsApp text notification — only if operator has a mobile number.
    // The in-app notification above is the primary signal; WhatsApp is
    // a nice-to-have that fails silently when the operator is outside
    // the 24h conversation window (no error log in that case — that's
    // expected, not a bug).
    if (operator.mobileNumber) {
      const waEnabled = await isWhatsAppEnabled();
      if (waEnabled) {
        const { sendWhatsAppText } = await import('@/lib/whatsapp');
        const result = await sendWhatsAppText(operator.mobileNumber, msg);
        if (!result?.success && !result?.outsideWindow) {
          console.warn('[Notifications] Operator WhatsApp send failed:', {
            operatorId: operator.operatorId,
            error: result?.error || 'unknown',
          });
        }
      } else {
        console.log('[Notifications] WhatsApp disabled, skipped operator text:', operator.operatorId);
      }
    } else {
      console.warn('[Notifications] Operator has no mobile number, WhatsApp skipped:', operator.operatorId);
    }
  } catch (err) {
    console.error('[Notifications] Failed to notify operator about new booking:', err);
  }
}

/**
 * Notify the assigned operator about a booking cancellation via WhatsApp text + in-app.
 * Falls back silently if no operator assigned or WhatsApp not configured.
 */
export async function notifyOperatorBookingCancelled(
  bookingId: string,
  details: {
    customerName: string;
    date: string;
    time: string;
    machine: string;
    cancelledBy: string;
    reason?: string;
  },
): Promise<void> {
  try {
    const operator = await getBookingOperator(bookingId);
    if (!operator) return;

    const lines = [
      `Booking Cancelled`,
      `Center: ${operator.centerName}`,
      `Customer: ${details.customerName}`,
      `Date: ${details.date}`,
      `Time: ${details.time}`,
      `Machine: ${details.machine}`,
      `Cancelled by: ${details.cancelledBy}`,
    ];
    if (details.reason) lines.push(`Reason: ${details.reason}`);
    const msg = lines.join('\n');

    // In-app notification for the operator
    await notify({
      userId: operator.operatorId,
      title: 'Booking Cancelled',
      message: msg.replace(/\n/g, ' | '),
      type: 'CANCELLATION',
    });

    // WhatsApp text notification — see notifyOperatorNewBooking above
    // for the rationale on the outside-window soft fail.
    if (operator.mobileNumber) {
      const waEnabled = await isWhatsAppEnabled();
      if (waEnabled) {
        const result = await sendWhatsAppText(operator.mobileNumber, msg);
        if (!result?.success && !result?.outsideWindow) {
          console.warn('[Notifications] Operator cancel WhatsApp send failed:', {
            operatorId: operator.operatorId,
            error: result?.error || 'unknown',
          });
        }
      }
    }
  } catch (err) {
    console.error('[Notifications] Failed to notify operator about cancellation:', err);
  }
}

/**
 * Alert the center's admins when a captured Razorpay payment ended up
 * auto-refunded (its booking failed) or — worse — could neither be booked
 * nor refunded and needs manual action. In-app is the guaranteed channel;
 * WhatsApp is best-effort (soft-fails outside the 24h window). Never throws:
 * alerting must not mask the original booking/refund error.
 */
export async function notifyAdminPaymentIssue(opts: {
  paymentId: string;
  outcome: 'REFUNDED' | 'NEEDS_ATTENTION';
  reason: string;
}): Promise<void> {
  try {
    const payment = await prisma.payment.findUnique({
      where: { id: opts.paymentId },
      select: { amount: true, userId: true, centerId: true, razorpayPaymentId: true },
    });
    if (!payment) return;

    const [payer, center, admins] = await Promise.all([
      prisma.user.findUnique({ where: { id: payment.userId }, select: { name: true, mobileNumber: true } }),
      prisma.center.findUnique({ where: { id: payment.centerId }, select: { name: true } }),
      prisma.centerMembership.findMany({
        where: { centerId: payment.centerId, role: 'ADMIN', isActive: true },
        select: { user: { select: { id: true, name: true, mobileNumber: true } } },
      }),
    ]);

    const recipients = admins
      .map((m) => m.user)
      .filter((u): u is { id: string; name: string | null; mobileNumber: string | null } => !!u);

    if (recipients.length === 0) {
      console.error('[Notifications] Payment issue but center has no active admins to alert:', {
        paymentId: opts.paymentId,
        centerId: payment.centerId,
        outcome: opts.outcome,
      });
      return;
    }

    const urgent = opts.outcome === 'NEEDS_ATTENTION';
    const centerName = center?.name || 'Center';
    const payerName = payer?.name || 'Customer';
    const payerMobile = payer?.mobileNumber ? ` (${payer.mobileNumber})` : '';
    const lines = [
      urgent
        ? 'URGENT: a captured payment could NOT be booked or refunded — manual action needed.'
        : 'A captured payment failed to book and was auto-refunded to the customer wallet.',
      `Center: ${centerName}`,
      `Customer: ${payerName}${payerMobile}`,
      `Amount: ₹${payment.amount}`,
      `Payment: ${opts.paymentId}${payment.razorpayPaymentId ? ` / ${payment.razorpayPaymentId}` : ''}`,
      `Reason: ${opts.reason}`,
      urgent
        ? 'Action: refund in Razorpay or retry at /admin/payments/orphans.'
        : 'No action needed — wallet already credited.',
    ];
    const title = urgent ? 'Payment needs manual action' : 'Payment auto-refunded';
    const inApp = lines.join(' | ');
    const waText = lines.join('\n');

    // In-app — the guaranteed channel, one notification per admin.
    await Promise.all(
      recipients.map((u) =>
        notify({ userId: u.id, title, message: inApp, type: urgent ? 'WARNING' : 'INFO' }).catch((e) =>
          console.error('[Notifications] Admin payment-issue in-app failed:', {
            adminId: u.id,
            error: e instanceof Error ? e.message : String(e),
          }),
        ),
      ),
    );

    // WhatsApp — best-effort, run in parallel so N admins don't serialise the
    // per-request 5s BSP cap.
    const waEnabled = await isWhatsAppEnabled();
    if (waEnabled) {
      await Promise.all(
        recipients
          .filter((u) => !!u.mobileNumber)
          .map(async (u) => {
            try {
              const r = await sendWhatsAppText(u.mobileNumber as string, waText);
              if (!r?.success && !r?.outsideWindow) {
                console.warn('[Notifications] Admin payment-issue WhatsApp failed:', {
                  adminId: u.id,
                  error: r?.error || 'unknown',
                });
              }
            } catch (e) {
              console.warn('[Notifications] Admin payment-issue WhatsApp threw:', {
                adminId: u.id,
                error: e instanceof Error ? e.message : String(e),
              });
            }
          }),
      );
    }
  } catch (err) {
    console.error('[Notifications] notifyAdminPaymentIssue failed:', err instanceof Error ? err.message : String(err));
  }
}

// ─── Assigned-Staff Notification Helpers (operator + coach + specialist) ─
//
// The operator-only helpers above predate the resource-based booking
// model, which can also assign a Personal Coach (`assignedCoachId`) or a
// Trainer Specialist / sidearm staff (`assignedStaffId`). These helpers
// load the booking with all of its relations and notify EVERY assigned
// staff member — Machine Operator, Personal Coach, and Trainer Specialist
// — about a new booking or a cancellation, via WhatsApp text + in-app.
//
// Design notes:
//   - Notifications go only to staff actually assigned to the booking (and
//     therefore implicitly to the booking's center + role).
//   - WhatsApp is sent only when the staff member has a mobile number and
//     the WHATSAPP_NOTIFICATIONS_ENABLED flag is on; in-app is always made.
//   - Every delivery attempt is logged (success / outside-window / error)
//     so deliveries can be audited and troubleshooting is possible.
//   - All failures are swallowed — staff notifications must never block or
//     fail a booking/cancellation.

/** Friendly role labels used in staff-facing messages. */
const STAFF_ROLE_LABELS = {
  OPERATOR: 'Machine Operator',
  COACH: 'Personal Coach',
  SIDEARM_SPECIALIST: 'Trainer Specialist',
  GROUND_STAFF: 'Ground Staff',
} as const;

// Categories whose on-ground handling falls to the center's ground staff
// (they have no per-booking operator/coach/specialist that already
// covers the floor). MACHINE is excluded — its operator is the on-ground
// contact. Used to decide when to additionally ping the center's
// GROUND_STAFF member about a booking.
const GROUND_STAFF_CATEGORIES: BookingCategory[] = ['NET', 'FULL_COURT', 'SIDEARM', 'COACHING'];

/** Human-readable labels for each booking category. */
const CATEGORY_LABELS: Record<BookingCategory, string> = {
  MACHINE: 'Bowling Machine',
  SIDEARM: 'Sidearm Session',
  COACHING: 'Personal Coaching',
  FULL_COURT: 'Full Court',
  CORPORATE_BATCH: 'Corporate Batch',
  NET: 'Net Practice',
};

type StaffRoleKey = keyof typeof STAFF_ROLE_LABELS;

interface StaffRecipient {
  userId: string;
  name: string;
  mobileNumber: string | null;
  roleKey: StaffRoleKey;
}

/** Shape returned by the booking lookup used for staff notifications. */
type StaffNotifyBooking = {
  id: string;
  playerName: string;
  date: Date;
  startTime: Date;
  endTime: Date;
  category: BookingCategory;
  machineId: string | null;
  pitchType: string | null;
  ballType: string | null;
  operationMode: string | null;
  price: number | null;
  paymentMethod: string | null;
  paymentStatus: string | null;
  kitRental: boolean;
  kitRentalCharge: number | null;
  centerId: string;
  cancelledBy: string | null;
  cancellationReason: string | null;
  center: { name: string; mapUrl: string | null } | null;
  // Customer phone — surfaced to staff on the dedicated template so they
  // can reach the booker directly. The reused `booking_detail` template
  // has no slot for it (it's customer-facing), so it's only used when a
  // dedicated staff template is configured.
  user: { mobileNumber: string | null } | null;
  operator: { id: string; name: string | null; mobileNumber: string | null } | null;
  assignedCoach: { id: string; name: string | null; mobileNumber: string | null } | null;
  assignedStaff: { id: string; name: string | null; mobileNumber: string | null } | null;
  assignedMachine: { name: string; machineType: { name: string } | null } | null;
  resourceAssignments: { resource: { name: string } | null }[];
  packageBooking: { id: string } | null;
};

const STAFF_NOTIFY_SELECT = {
  id: true,
  playerName: true,
  date: true,
  startTime: true,
  endTime: true,
  category: true,
  machineId: true,
  pitchType: true,
  ballType: true,
  operationMode: true,
  price: true,
  paymentMethod: true,
  paymentStatus: true,
  kitRental: true,
  kitRentalCharge: true,
  centerId: true,
  cancelledBy: true,
  cancellationReason: true,
  center: { select: { name: true, mapUrl: true } },
  user: { select: { mobileNumber: true } },
  operator: { select: { id: true, name: true, mobileNumber: true } },
  assignedCoach: { select: { id: true, name: true, mobileNumber: true } },
  assignedStaff: { select: { id: true, name: true, mobileNumber: true } },
  assignedMachine: { select: { name: true, machineType: { select: { name: true } } } },
  resourceAssignments: { select: { resource: { select: { name: true } } } },
  packageBooking: { select: { id: true } },
} as const;

/** Collect every assigned staff member across a set of bookings (deduped). */
function collectStaffRecipients(bookings: StaffNotifyBooking[]): StaffRecipient[] {
  const byUser = new Map<string, StaffRecipient>();
  const add = (
    person: { id: string; name: string | null; mobileNumber: string | null } | null,
    roleKey: StaffRoleKey,
  ) => {
    if (!person || byUser.has(person.id)) return;
    byUser.set(person.id, {
      userId: person.id,
      name: person.name || STAFF_ROLE_LABELS[roleKey],
      mobileNumber: person.mobileNumber || null,
      roleKey,
    });
  };
  for (const b of bookings) {
    add(b.operator, 'OPERATOR');
    add(b.assignedCoach, 'COACH');
    add(b.assignedStaff, 'SIDEARM_SPECIALIST');
  }
  return [...byUser.values()];
}

/**
 * Resolve the center's primary ground-staff recipient, if one is
 * configured. Ground staff are a center-level role (not pinned per
 * booking), so we pick the highest-priority active GROUND_STAFF
 * membership — the same one the user-facing booking views surface as the
 * "Call" contact for Cricket Net / Full Court sessions. Returns null when
 * the center has no ground staff. Never throws — a lookup failure just
 * means ground staff aren't paged (assigned staff are unaffected).
 */
async function loadGroundStaffRecipient(centerId: string): Promise<StaffRecipient | null> {
  try {
    const membership = await prisma.centerMembership.findFirst({
      where: { centerId, role: 'GROUND_STAFF', isActive: true },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      select: { user: { select: { id: true, name: true, mobileNumber: true } } },
    });
    if (!membership?.user) return null;
    return {
      userId: membership.user.id,
      name: membership.user.name || STAFF_ROLE_LABELS.GROUND_STAFF,
      mobileNumber: membership.user.mobileNumber || null,
      roleKey: 'GROUND_STAFF',
    };
  } catch (err) {
    console.error('[Notifications] Failed to load ground staff recipient:', {
      centerId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Append the center's ground-staff recipient to an existing recipient
 * list when at least one booking is a category that ground staff handle
 * on the floor (Cricket Net / Full Court / Sidearm / Coaching). Deduped
 * by userId so a ground-staff member who is also the assigned coach /
 * specialist isn't paged twice.
 */
async function withGroundStaff(
  recipients: StaffRecipient[],
  bookings: StaffNotifyBooking[],
): Promise<StaffRecipient[]> {
  const needsGroundStaff = bookings.some((b) => GROUND_STAFF_CATEGORIES.includes(b.category));
  if (!needsGroundStaff) return recipients;
  const ground = await loadGroundStaffRecipient(bookings[0].centerId);
  if (!ground) return recipients;
  if (recipients.some((r) => r.userId === ground.userId)) return recipients;
  return [...recipients, ground];
}

/** Resolve the facility / resource name(s) for a booking. */
function resolveFacility(booking: StaffNotifyBooking): string {
  const resourceNames = booking.resourceAssignments
    .map((a) => a.resource?.name)
    .filter((n): n is string => !!n);
  if (resourceNames.length > 0) return resourceNames.join(', ');
  // Legacy MACHINE_PITCH (ABCA): no Resource rows — fall back to the
  // machine's short name.
  if (booking.machineId) {
    return MACHINES[booking.machineId as keyof typeof MACHINES]?.shortName || booking.machineId;
  }
  return 'Net';
}

/** Format a duration in minutes as "1 hr 30 min" / "45 min". */
function formatDuration(totalMinutes: number): string {
  if (totalMinutes <= 0) return '—';
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours > 0 && mins > 0) return `${hours} hr ${mins} min`;
  if (hours > 0) return `${hours} hr`;
  return `${mins} min`;
}

/**
 * Deliver an in-app + WhatsApp message to every assigned staff recipient.
 * Logs each delivery attempt. Never throws.
 *
 * WhatsApp delivery prefers an APPROVED TEMPLATE (`buildWhatsAppTemplate`)
 * when supplied. This is the crucial fix for staff alerts: WhatsApp (Meta /
 * Twilio) only delivers *free-form* text to a recipient who messaged the
 * business in the last 24h. Staff almost never do, so the previous
 * free-form-only path was silently dropped for them ("outside 24h window")
 * while customers — who get an approved template — received theirs. Approved
 * templates deliver regardless of the conversation window, so routing staff
 * through one closes the gap.
 *
 * The free-form text (`buildWhatsApp`) is kept as a best-effort fallback:
 * used only when no template builder is supplied, the builder returns null,
 * or the template send fails. (Free-form still reaches staff who happen to
 * be inside the 24h window.)
 */
async function dispatchStaffNotifications(opts: {
  bookingId: string;
  recipients: StaffRecipient[];
  title: string;
  type: string;
  inAppMessage: string;
  buildWhatsApp: (recipient: StaffRecipient) => string;
  buildWhatsAppTemplate?: (recipient: StaffRecipient) => WhatsAppTemplatePayload | null;
}): Promise<void> {
  const { bookingId, recipients, title, type, inAppMessage, buildWhatsApp, buildWhatsAppTemplate } = opts;
  if (recipients.length === 0) return;

  const waEnabled = await isWhatsAppEnabled();

  for (const recipient of recipients) {
    // In-app notification is the primary, always-on signal.
    try {
      await notify({
        userId: recipient.userId,
        title,
        message: inAppMessage,
        type,
      });
    } catch (err) {
      console.error('[Notifications] Staff in-app notification failed:', {
        bookingId,
        userId: recipient.userId,
        role: recipient.roleKey,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // WhatsApp — only when enabled and the staff member has a mobile number.
    if (!recipient.mobileNumber) {
      console.warn('[Notifications] Staff WhatsApp skipped — no mobile number:', {
        bookingId,
        userId: recipient.userId,
        role: recipient.roleKey,
      });
      continue;
    }
    if (!waEnabled) {
      console.log('[Notifications] WhatsApp disabled — staff text skipped:', {
        bookingId,
        userId: recipient.userId,
        role: recipient.roleKey,
      });
      continue;
    }

    const logCtx = { bookingId, userId: recipient.userId, role: recipient.roleKey };

    // ── Primary: approved template (delivers outside the 24h window) ──
    let templateDelivered = false;
    const templatePayload = buildWhatsAppTemplate?.(recipient) ?? null;
    if (templatePayload) {
      try {
        const result = await sendWhatsAppNotification(
          templatePayload.mobileNumber,
          templatePayload.templateName,
          templatePayload.components,
          templatePayload.language,
        );
        if (result === null) {
          // Provider not configured — the free-form fallback would also
          // be unconfigured, so skip it and move on.
          console.warn('[Notifications] Staff WhatsApp skipped — provider not configured:', logCtx);
          continue;
        }
        if (result.success) {
          console.log('[Notifications] Staff WhatsApp template sent:', {
            ...logCtx,
            template: templatePayload.templateName,
            messageId: result.messageId,
          });
          templateDelivered = true;
        } else {
          console.warn('[Notifications] Staff WhatsApp template failed — trying text fallback:', {
            ...logCtx,
            template: templatePayload.templateName,
            error: result.error || 'unknown',
          });
        }
      } catch (err) {
        console.error('[Notifications] Staff WhatsApp template threw — trying text fallback:', {
          ...logCtx,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (templateDelivered) continue;

    // ── Fallback: free-form text (best-effort, in-window only) ──
    try {
      const result = await sendWhatsAppText(recipient.mobileNumber, buildWhatsApp(recipient));
      if (result?.success) {
        console.log('[Notifications] Staff WhatsApp text sent:', { ...logCtx, messageId: result.messageId });
      } else if (result?.outsideWindow) {
        // Expected when the staff member hasn't messaged the business in
        // the last 24h AND no approved template was available. Logged for
        // the audit trail — configure WHATSAPP_STAFF_BOOKING_TEMPLATE (or
        // rely on the booking_detail reuse) to deliver these reliably.
        console.log('[Notifications] Staff WhatsApp outside 24h window (text fallback):', logCtx);
      } else {
        console.warn('[Notifications] Staff WhatsApp text fallback failed:', {
          ...logCtx,
          error: result?.error || 'unknown',
        });
      }
    } catch (err) {
      console.error('[Notifications] Staff WhatsApp text fallback threw:', {
        ...logCtx,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Notify all assigned staff (Machine Operator, Personal Coach, Trainer
 * Specialist) about a NEW booking via WhatsApp + in-app.
 *
 * Accepts the list of Booking ids created in one submission (a multi-slot
 * booking produces several rows). The time window/duration spans all of
 * them; assigned staff are collected across the whole batch (deduped).
 *
 * Never throws — failures are logged and swallowed so a notification
 * problem can't fail the booking.
 */
export async function notifyAssignedStaffNewBooking(bookingIds: string[]): Promise<void> {
  if (bookingIds.length === 0) return;
  try {
    const bookings = (await prisma.booking.findMany({
      where: { id: { in: bookingIds } },
      select: STAFF_NOTIFY_SELECT,
    })) as StaffNotifyBooking[];
    if (bookings.length === 0) return;

    // Per-booking assigned staff (operator / coach / specialist) plus the
    // center's ground staff for floor-handled categories (Net / Full
    // Court / Sidearm / Coaching).
    const recipients = await withGroundStaff(collectStaffRecipients(bookings), bookings);
    if (recipients.length === 0) return;

    const primary = bookings[0];
    const earliestStart = bookings.reduce(
      (acc, b) => (b.startTime < acc ? b.startTime : acc),
      bookings[0].startTime,
    );
    const latestEnd = bookings.reduce(
      (acc, b) => (b.endTime > acc ? b.endTime : acc),
      bookings[0].endTime,
    );
    const totalMinutes = bookings.reduce(
      (sum, b) => sum + Math.round((b.endTime.getTime() - b.startTime.getTime()) / 60000),
      0,
    );

    const dateStr = formatIST(new Date(primary.date), 'EEE, dd MMM yyyy');
    const timeStr = `${formatIST(earliestStart, 'hh:mm a')} – ${formatIST(latestEnd, 'hh:mm a')}`;
    const slotCount = bookings.length;
    const slotSuffix = slotCount > 1 ? ` (${slotCount} slots)` : '';
    const facility = resolveFacility(primary);
    const bookingType = CATEGORY_LABELS[primary.category];
    const centerName = primary.center?.name || 'PlayOrbit';
    const durationStr = formatDuration(totalMinutes);
    const detailSegments = buildBookingDetailSegments(primary);

    // Price across the whole batch — mirrors the customer confirmation so
    // staff see the same figure the booker paid (or "Pay at center" / a
    // package session). Used as the {{5}} param when reusing booking_detail.
    const isPackage = bookings.some((b) => !!b.packageBooking);
    const total = bookings.reduce((sum, b) => sum + (b.price ?? 0), 0);
    const anyCashPending = bookings.some(
      (b) => b.paymentMethod === 'CASH' && b.paymentStatus === 'PENDING',
    );
    const priceStr = isPackage
      ? 'Package session'
      : total <= 0
        ? 'FREE'
        : anyCashPending
          ? `₹${total} (Pay at center)`
          : `₹${total}`;

    // The on-ground contact for this booking — the operator for a machine
    // session, the specialist for sidearm, the coach for coaching. Reused
    // as the {{6}}/{{7}} ("Operator"/"Contact") params of booking_detail so
    // the staff message reads exactly like the customer's confirmation.
    const contactPerson =
      primary.category === 'MACHINE'
        ? primary.operator
        : primary.category === 'SIDEARM'
          ? primary.assignedStaff
          : primary.category === 'COACHING'
            ? primary.assignedCoach
            : null;
    const contactName = contactPerson?.name || 'To be assigned';
    const contactPhone = contactPerson?.mobileNumber || 'Will be shared soon';
    const customerPhone = primary.user?.mobileNumber || 'N/A';
    // Who booked, for the staff alert: the customer's name + phone. Staff
    // need to know which customer they're serving (and how to reach them) —
    // without this the reused customer template reads like the booker's own
    // confirmation, with no booker identity on it.
    const bookedBy =
      customerPhone !== 'N/A' ? `${primary.playerName} (${customerPhone})` : primary.playerName;

    // In-app + free-form text carry the same admin-Bookings-page detail
    // rows (Category / Machine / Pitch / Ball / Operation / assigned
    // person / Payment / Kit) plus the customer's name + phone so staff
    // can reach the booker directly.
    const inAppMessage = [
      `Customer: ${primary.playerName}`,
      ...(customerPhone !== 'N/A' ? [`Phone: ${customerPhone}`] : []),
      `Date: ${dateStr}`,
      `Time: ${timeStr}${slotSuffix}`,
      `Facility: ${facility}`,
      ...detailSegments,
      `Price: ${priceStr}`,
    ].join(' | ');

    const buildWhatsApp = (recipient: StaffRecipient): string => {
      const lines = [
        `🏏 *New Booking*`,
        `🏢 Center: ${centerName}`,
        `Hi ${recipient.name} (${STAFF_ROLE_LABELS[recipient.roleKey]}),`,
        `A new booking has been assigned to you.`,
        ``,
        `👤 Customer: ${primary.playerName}`,
        ...(customerPhone !== 'N/A' ? [`📞 Phone: ${customerPhone}`] : []),
        `📅 Date: ${dateStr}`,
        `⏰ Time: ${timeStr}${slotSuffix}`,
        `⏳ Duration: ${durationStr}`,
        `📍 Facility: ${facility}`,
        ...detailSegments.map((s) => `• ${s}`),
        `💰 Price: ${priceStr}`,
        `🔖 Booking ID: ${primary.id}${slotCount > 1 ? ` (+${slotCount - 1} more)` : ''}`,
      ];
      return lines.join('\n');
    };

    // Approved-template payload per recipient. A dedicated staff template
    // (richer — includes customer name + phone + the recipient's role) is
    // used when WHATSAPP_STAFF_BOOKING_TEMPLATE is set; otherwise we reuse
    // the already-approved customer `booking_detail` template so staff get
    // alerts immediately with no BSP changes. See docs/whatsapp-templates.md.
    const dedicatedTemplate = process.env.WHATSAPP_STAFF_BOOKING_TEMPLATE?.trim();
    const buildWhatsAppTemplate = (recipient: StaffRecipient): WhatsAppTemplatePayload | null => {
      if (!recipient.mobileNumber) return null;
      if (dedicatedTemplate) {
        // Dedicated staff template — 8 params (documented contract):
        // {{1}} center · {{2}} role · {{3}} customer · {{4}} customer phone
        // {{5}} date · {{6}} time · {{7}} type · {{8}} facility
        return {
          mobileNumber: recipient.mobileNumber,
          templateName: dedicatedTemplate,
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: centerName },
                { type: 'text', text: STAFF_ROLE_LABELS[recipient.roleKey] },
                { type: 'text', text: primary.playerName },
                { type: 'text', text: customerPhone },
                { type: 'text', text: dateStr },
                { type: 'text', text: `${timeStr}${slotSuffix}` },
                { type: 'text', text: bookingType },
                { type: 'text', text: facility },
              ],
            },
          ],
        };
      }
      // Reuse the approved customer `booking_detail` template (7 params).
      // The customer's name + phone are folded into the facility param
      // ({{4}}) so the staff member knows who booked and how to reach them —
      // the template has no dedicated customer slot, and {{4}} carries no
      // misleading baked label (set WHATSAPP_STAFF_BOOKING_TEMPLATE for a
      // fully staff-shaped message that puts the customer in its own field).
      return {
        mobileNumber: recipient.mobileNumber,
        templateName: 'booking_detail',
        components: [
          {
            type: 'body',
            parameters: buildBookingDetailParams(
              [
                `${centerName} • ${dateStr}`,
                `${timeStr}${slotSuffix}`,
                bookingType,
                `${facility} • Booked by ${bookedBy}`,
                priceStr,
                contactName,
                contactPhone,
              ],
              primary.center?.mapUrl ?? null,
            ),
          },
        ],
      };
    };

    await dispatchStaffNotifications({
      bookingId: primary.id,
      recipients,
      title: 'New Booking Assigned',
      type: 'SUCCESS',
      inAppMessage,
      buildWhatsApp,
      buildWhatsAppTemplate,
    });
  } catch (err) {
    console.error('[Notifications] notifyAssignedStaffNewBooking failed:', err);
  }
}

/**
 * Notify all assigned staff (Machine Operator, Personal Coach, Trainer
 * Specialist) about a CANCELLED booking via WhatsApp + in-app.
 *
 * Load the booking AFTER it's been marked CANCELLED (so the assigned-staff
 * FKs are still intact — cancellation doesn't clear them). Never throws.
 */
export async function notifyAssignedStaffBookingCancelled(
  bookingId: string,
  details: { cancelledBy?: string; reason?: string } = {},
): Promise<void> {
  try {
    const booking = (await prisma.booking.findUnique({
      where: { id: bookingId },
      select: STAFF_NOTIFY_SELECT,
    })) as StaffNotifyBooking | null;
    if (!booking) return;

    const recipients = await withGroundStaff(collectStaffRecipients([booking]), [booking]);
    if (recipients.length === 0) return;

    const dateStr = formatIST(new Date(booking.date), 'EEE, dd MMM yyyy');
    const timeStr = `${formatIST(booking.startTime, 'hh:mm a')} – ${formatIST(booking.endTime, 'hh:mm a')}`;
    const facility = resolveFacility(booking);
    const bookingType = CATEGORY_LABELS[booking.category];
    const centerName = booking.center?.name || 'PlayOrbit';
    const cancelledBy = details.cancelledBy || booking.cancelledBy || 'Center';
    const reason = details.reason || booking.cancellationReason || undefined;
    const customerPhone = booking.user?.mobileNumber || 'N/A';
    const detailSegments = buildBookingDetailSegments(booking);

    const inAppMessage = [
      `Customer: ${booking.playerName}`,
      ...(customerPhone !== 'N/A' ? [`Phone: ${customerPhone}`] : []),
      `Date: ${dateStr}`,
      `Time: ${timeStr}`,
      `Facility: ${facility}`,
      ...detailSegments,
      `Cancelled by: ${cancelledBy}`,
      ...(reason ? [`Reason: ${reason}`] : []),
    ].join(' | ');

    const buildWhatsApp = (recipient: StaffRecipient): string => {
      const lines = [
        `❌ *Booking Cancelled*`,
        `🏢 Center: ${centerName}`,
        `Hi ${recipient.name} (${STAFF_ROLE_LABELS[recipient.roleKey]}),`,
        `A booking assigned to you has been cancelled.`,
        ``,
        `👤 Customer: ${booking.playerName}`,
        ...(customerPhone !== 'N/A' ? [`📞 Phone: ${customerPhone}`] : []),
        `📅 Date: ${dateStr}`,
        `⏰ Time: ${timeStr}`,
        `📍 Facility: ${facility}`,
        ...detailSegments.map((s) => `• ${s}`),
        `🚫 Status: Cancelled`,
        `🙍 Cancelled by: ${cancelledBy}`,
      ];
      if (reason) lines.push(`📝 Reason: ${reason}`);
      lines.push(`🔖 Booking ID: ${booking.id}`);
      return lines.join('\n');
    };

    // Approved-template payload per recipient — the fix that makes staff
    // cancellation alerts actually arrive. WhatsApp only delivers free-form
    // text to someone who messaged the business in the last 24h, which
    // staff almost never do, so the free-form `buildWhatsApp` above was
    // silently dropped for them ("outside 24h window"): staff got the
    // new-booking alert (sent via a template) but NOT the cancellation. An
    // approved template delivers regardless of the 24h window. By default
    // we reuse the already-approved customer `booking_cancelled` template
    // (1 param, no BSP changes needed); set WHATSAPP_STAFF_CANCEL_TEMPLATE
    // to a dedicated 8-param approved template for a richer, role-aware
    // message. See docs/whatsapp-templates.md.
    const dedicatedTemplate = process.env.WHATSAPP_STAFF_CANCEL_TEMPLATE?.trim();
    const buildWhatsAppTemplate = (recipient: StaffRecipient): WhatsAppTemplatePayload | null => {
      if (!recipient.mobileNumber) return null;
      if (dedicatedTemplate) {
        // Dedicated staff-cancel template — 8 params (documented contract):
        // {{1}} center · {{2}} role · {{3}} customer · {{4}} customer phone
        // {{5}} date · {{6}} time · {{7}} type · {{8}} cancelled by
        return {
          mobileNumber: recipient.mobileNumber,
          templateName: dedicatedTemplate,
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: centerName },
                { type: 'text', text: STAFF_ROLE_LABELS[recipient.roleKey] },
                { type: 'text', text: booking.playerName },
                { type: 'text', text: customerPhone },
                { type: 'text', text: dateStr },
                { type: 'text', text: timeStr },
                { type: 'text', text: bookingType },
                { type: 'text', text: cancelledBy },
              ],
            },
          ],
        };
      }
      // Reuse the approved customer `booking_cancelled` template (1 param).
      // Meta rejects newlines, tabs and 4+ consecutive spaces in params, so
      // the detail string is flattened the same way the customer cancel
      // alert is.
      const detail = [
        `${centerName} • ${STAFF_ROLE_LABELS[recipient.roleKey]} session cancelled`,
        `Customer: ${booking.playerName}`,
        ...(customerPhone !== 'N/A' ? [`Phone: ${customerPhone}`] : []),
        `${dateStr}, ${timeStr}`,
        facility,
        `Cancelled by: ${cancelledBy}`,
        ...(reason ? [`Reason: ${reason}`] : []),
      ]
        .join(' | ')
        .replace(/[\n\t]/g, ' ')
        .replace(/\s{4,}/g, '   ');
      return {
        mobileNumber: recipient.mobileNumber,
        templateName: 'booking_cancelled',
        components: [{ type: 'body', parameters: [{ type: 'text', text: detail }] }],
      };
    };

    await dispatchStaffNotifications({
      bookingId: booking.id,
      recipients,
      title: 'Booking Cancelled',
      type: 'CANCELLATION',
      inAppMessage,
      buildWhatsApp,
      buildWhatsAppTemplate,
    });
  } catch (err) {
    console.error('[Notifications] notifyAssignedStaffBookingCancelled failed:', err);
  }
}

// ─── Customer Booking Confirmation (all categories) ─────────────────
//
// The legacy MACHINE_PITCH flow (/api/slots/book) calls
// notifyBookingConfirmed() directly. The resource-based engine
// (/api/slots/book-resource → executeResourceBooking) only notified the
// assigned staff — customers booking Sidearm / Coaching / Cricket Net /
// Full Court / Bowling Machine sessions on RESOURCE_BASED centers got no
// confirmation at all. This helper closes that gap: it loads the created
// booking row(s), derives category-appropriate fields, and reuses the
// approved `booking_detail` WhatsApp template (plus the always-on in-app
// notification) so every category confirms the same way.

/** Customer-facing label per category (machine name takes over for MACHINE). */
const CUSTOMER_CATEGORY_LABELS: Record<BookingCategory, string> = {
  MACHINE: 'Bowling Machine',
  SIDEARM: 'Sidearm Session',
  COACHING: 'Personal Coaching',
  NET: 'Cricket Net',
  FULL_COURT: 'Full Indoor Court',
  CORPORATE_BATCH: 'Corporate Batch',
};

const CUSTOMER_PITCH_LABELS: Record<string, string> = {
  ASTRO: 'Astro Turf',
  CEMENT: 'Cement Wicket',
  NATURAL: 'Natural Turf',
  TURF: 'Cement Wicket',
};

type CustomerNotifyBooking = {
  id: string;
  userId: string | null;
  playerName: string;
  date: Date;
  startTime: Date;
  endTime: Date;
  category: BookingCategory;
  machineId: string | null;
  pitchType: string | null;
  ballType: string | null;
  operationMode: string | null;
  price: number | null;
  status: string;
  paymentMethod: string | null;
  paymentStatus: string | null;
  kitRental: boolean;
  kitRentalCharge: number | null;
  user: { mobileNumber: string | null; mobileVerified: boolean } | null;
  center: { name: string; mapUrl: string | null } | null;
  operator: { name: string | null; mobileNumber: string | null } | null;
  assignedCoach: { name: string | null; mobileNumber: string | null } | null;
  assignedStaff: { name: string | null; mobileNumber: string | null } | null;
  assignedMachine: { name: string; machineType: { name: string } | null } | null;
  resourceAssignments: { resource: { name: string } | null }[];
  packageBooking: { id: string } | null;
};

const CUSTOMER_NOTIFY_SELECT = {
  id: true,
  userId: true,
  playerName: true,
  date: true,
  startTime: true,
  endTime: true,
  category: true,
  machineId: true,
  pitchType: true,
  ballType: true,
  operationMode: true,
  price: true,
  status: true,
  paymentMethod: true,
  paymentStatus: true,
  kitRental: true,
  kitRentalCharge: true,
  user: { select: { mobileNumber: true, mobileVerified: true } },
  center: { select: { name: true, mapUrl: true } },
  operator: { select: { name: true, mobileNumber: true } },
  assignedCoach: { select: { name: true, mobileNumber: true } },
  assignedStaff: { select: { name: true, mobileNumber: true } },
  assignedMachine: { select: { name: true, machineType: { select: { name: true } } } },
  resourceAssignments: { select: { resource: { select: { name: true } } } },
  packageBooking: { select: { id: true } },
} as const;

/**
 * Confirm a newly created booking to the customer (in-app always, plus
 * WhatsApp when enabled and the user's mobile is verified). Works for
 * every booking category. Accepts the booking ids from one submission
 * (a multi-slot booking produces several rows). Never throws — a
 * notification failure must not fail the booking.
 */
export async function notifyCustomerNewBooking(bookingIds: string[]): Promise<void> {
  if (bookingIds.length === 0) return;
  try {
    const bookings = (await prisma.booking.findMany({
      where: { id: { in: bookingIds } },
      select: CUSTOMER_NOTIFY_SELECT,
    })) as CustomerNotifyBooking[];
    if (bookings.length === 0) return;

    // Defensive: only confirm live rows. Never send a "confirmed" message
    // for a booking that was cancelled between creation and this call.
    const active = bookings.filter((b) => b.status !== 'CANCELLED');
    if (active.length === 0) return;

    const primary = active[0];
    if (!primary.userId) return; // walk-in with no account to notify

    const earliestStart = active.reduce(
      (acc, b) => (b.startTime < acc ? b.startTime : acc),
      active[0].startTime,
    );
    const latestEnd = active.reduce(
      (acc, b) => (b.endTime > acc ? b.endTime : acc),
      active[0].endTime,
    );
    const slotCount = active.length;
    const slotSuffix = slotCount > 1 ? ` (${slotCount} slots)` : '';

    const dateStr = formatIST(new Date(primary.date), 'EEE, dd MMM yyyy');
    const timeStr = `${formatIST(earliestStart, 'hh:mm a')} – ${formatIST(latestEnd, 'hh:mm a')}${slotSuffix}`;

    // Headline ({{3}}): the machine for MACHINE bookings, otherwise the
    // friendly category label so Sidearm / Coaching / Net / Court all
    // read naturally.
    const machineName =
      primary.assignedMachine?.name ||
      (primary.machineId
        ? MACHINES[primary.machineId as keyof typeof MACHINES]?.shortName || primary.machineId
        : null);
    const headline =
      primary.category === 'MACHINE'
        ? machineName || CUSTOMER_CATEGORY_LABELS.MACHINE
        : CUSTOMER_CATEGORY_LABELS[primary.category];

    // Facility detail ({{4}}): pitch surface where it applies, else the
    // assigned resource (net/court) name, else the center name.
    const pitchLabel = primary.pitchType
      ? CUSTOMER_PITCH_LABELS[primary.pitchType] || primary.pitchType
      : null;
    const resourceName =
      primary.resourceAssignments.map((a) => a.resource?.name).find((n): n is string => !!n) || null;
    const facility =
      primary.category === 'FULL_COURT'
        ? 'Full Court'
        : pitchLabel || resourceName || primary.center?.name || '—';

    // On-ground contact ({{6}}/{{7}}): the relevant assigned person for
    // the category. Net / Full Court have no per-booking person, so the
    // template falls back to "To be assigned".
    const contactPerson =
      primary.category === 'MACHINE'
        ? primary.operator
        : primary.category === 'SIDEARM'
          ? primary.assignedStaff
          : primary.category === 'COACHING'
            ? primary.assignedCoach
            : null;

    // Price total across all slots.
    const isPackage = !!primary.packageBooking;
    const total = active.reduce((sum, b) => sum + (b.price ?? 0), 0);
    let priceStr: string;
    if (isPackage) priceStr = 'Package session';
    else if (total <= 0) priceStr = 'FREE';
    else if (primary.paymentMethod === 'CASH' && primary.paymentStatus === 'PENDING')
      priceStr = `₹${total} (Pay at center)`;
    else priceStr = `₹${total}`;

    const kitRental = active.some((b) => b.kitRental);
    const kitRentalCharge = active.reduce(
      (sum, b) => sum + (b.kitRental ? b.kitRentalCharge ?? 0 : 0),
      0,
    );

    // Admin-Bookings-page detail rows (Category / Machine / Pitch / Ball /
    // Operation / assigned person / Payment / Kit) for the in-app alert.
    // Aggregate kit across the slots so the alert's Cricket Kit row matches
    // the total charged, not just the first slot's.
    const detailSegments = buildBookingDetailSegments({
      ...primary,
      kitRental,
      kitRentalCharge: kitRental ? kitRentalCharge : null,
    });

    await notifyBookingConfirmed(primary.userId, {
      date: dateStr,
      time: timeStr,
      machine: headline,
      pitch: facility,
      price: priceStr,
      operatorName: contactPerson?.name || undefined,
      operatorPhone: contactPerson?.mobileNumber || undefined,
      mobileNumber: primary.user?.mobileVerified ? primary.user.mobileNumber : null,
      kitRental,
      kitRentalCharge: kitRental ? kitRentalCharge : null,
      centerName: primary.center?.name || undefined,
      mapUrl: primary.center?.mapUrl ?? null,
      detailSegments,
      bookingId: primary.id,
    });
  } catch (err) {
    console.error('[Notifications] notifyCustomerNewBooking failed:', err);
  }
}
