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

/**
 * Send an in-app notification (always created in DB).
 * Optionally also sends via WhatsApp if the feature is enabled
 * AND the user has a verified mobile number.
 */
export async function notify(
  payload: NotificationPayload,
  whatsappTemplate?: WhatsAppTemplatePayload,
): Promise<SendResult> {
  const { userId, title, message, type = 'INFO' } = payload;

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
  },
): Promise<SendResult> {
  // Template booking_detail (7 params):
  // "🏏 *Booking Confirmed!*\n📅 {{1}}\n⏰ {{2}}\n🎯 {{3}} — {{4}}\n💰 {{5}}\n👤 Operator: {{6}}\n📞 Contact: {{7}}\n📍 PlayOrbit Cricket Nets + maps link"
  const kitInfo = details.kitRental ? ' + Cricket Kit' : '';
  const slotSummary = `${details.machine}, ${details.pitch} — ${details.time} on ${details.date} (${details.price}${kitInfo})`;
  const operatorName = details.operatorName || 'To be assigned';
  const operatorPhone = details.operatorPhone || 'Will be shared soon';

  return notify(
    {
      userId,
      title: 'Booking Confirmed',
      message: slotSummary,
      type: 'SUCCESS',
    },
    details.mobileNumber
      ? {
          mobileNumber: details.mobileNumber,
          templateName: 'booking_detail',
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: details.date },
                { type: 'text', text: details.time },
                { type: 'text', text: details.machine },
                { type: 'text', text: details.pitch },
                { type: 'text', text: details.price + kitInfo },
                { type: 'text', text: operatorName },
                { type: 'text', text: operatorPhone },
              ],
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
  },
): Promise<SendResult> {
  const fullMessage = details.refundInfo
    ? `${details.message}\n${details.refundInfo}`
    : details.message;

  // Template: "Your PlayOrbit booking has been cancelled: {{1}}. If a refund applies, it will be credited to your wallet."
  return notify(
    {
      userId,
      title: 'Booking Cancelled',
      message: fullMessage,
      type: 'CANCELLATION',
    },
    details.mobileNumber
      ? {
          mobileNumber: details.mobileNumber,
          templateName: 'booking_cancelled',
          components: [
            {
              type: 'body',
              // Meta WhatsApp API rejects newlines, tabs, and 4+ consecutive spaces in template params
              parameters: [{ type: 'text', text: details.message.replace(/[\n\t]/g, ' | ').replace(/\s{4,}/g, '   ') }],
            },
          ],
        }
      : undefined,
  );
}

/**
 * Notify user about a payment/package purchase.
 */
export async function notifyPaymentSuccess(
  userId: string,
  details: {
    message: string;
    mobileNumber?: string | null;
  },
): Promise<SendResult> {
  return notify(
    {
      userId,
      title: 'Payment Successful',
      message: details.message,
      type: 'SUCCESS',
    },
    details.mobileNumber
      ? {
          mobileNumber: details.mobileNumber,
          templateName: 'payment_success',
          components: [
            {
              type: 'body',
              parameters: [{ type: 'text', text: details.message }],
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
  },
): Promise<SendResult> {
  // Template: "PlayOrbit Wallet: ₹{{1}} credited. Reason: {{2}}. New balance: ₹{{3}}. Thank you!"
  const message = `₹${details.amount} credited to your wallet. Reason: ${details.reason}. Balance: ₹${details.newBalance}`;

  return notify(
    {
      userId,
      title: 'Wallet Credited',
      message,
      type: 'SUCCESS',
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
                { type: 'text', text: details.reason },
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
): Promise<{ operatorId: string; name: string; mobileNumber: string | null } | null> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      operatorId: true,
      operator: { select: { id: true, name: true, mobileNumber: true } },
    },
  });
  if (!booking?.operator) return null;
  return {
    operatorId: booking.operator.id,
    name: booking.operator.name || 'Operator',
    mobileNumber: booking.operator.mobileNumber || null,
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
} as const;

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
  cancelledBy: string | null;
  cancellationReason: string | null;
  center: { name: string } | null;
  operator: { id: string; name: string | null; mobileNumber: string | null } | null;
  assignedCoach: { id: string; name: string | null; mobileNumber: string | null } | null;
  assignedStaff: { id: string; name: string | null; mobileNumber: string | null } | null;
  assignedMachine: { name: string; machineType: { name: string } | null } | null;
  resourceAssignments: { resource: { name: string } | null }[];
};

const STAFF_NOTIFY_SELECT = {
  id: true,
  playerName: true,
  date: true,
  startTime: true,
  endTime: true,
  category: true,
  machineId: true,
  cancelledBy: true,
  cancellationReason: true,
  center: { select: { name: true } },
  operator: { select: { id: true, name: true, mobileNumber: true } },
  assignedCoach: { select: { id: true, name: true, mobileNumber: true } },
  assignedStaff: { select: { id: true, name: true, mobileNumber: true } },
  assignedMachine: { select: { name: true, machineType: { select: { name: true } } } },
  resourceAssignments: { select: { resource: { select: { name: true } } } },
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

/** Resolve a display label for the assigned machine, if any. */
function resolveMachineLabel(booking: StaffNotifyBooking): string | null {
  if (booking.assignedMachine) {
    const typeName = booking.assignedMachine.machineType?.name;
    return typeName
      ? `${booking.assignedMachine.name} (${typeName})`
      : booking.assignedMachine.name;
  }
  if (booking.machineId) {
    return MACHINES[booking.machineId as keyof typeof MACHINES]?.shortName || booking.machineId;
  }
  return null;
}

/** Build the "assigned details" lines shared across recipients. */
function buildAssignmentLines(booking: StaffNotifyBooking): string[] {
  const lines: string[] = [];
  const machineLabel = resolveMachineLabel(booking);
  if (machineLabel && booking.category === 'MACHINE') lines.push(`🎳 Machine: ${machineLabel}`);
  if (booking.assignedCoach?.name) lines.push(`👨‍🏫 Coach: ${booking.assignedCoach.name}`);
  if (booking.assignedStaff?.name) lines.push(`🏏 Specialist: ${booking.assignedStaff.name}`);
  if (booking.operator?.name && booking.category === 'MACHINE') {
    lines.push(`🧑‍🔧 Operator: ${booking.operator.name}`);
  }
  return lines;
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
 */
async function dispatchStaffNotifications(opts: {
  bookingId: string;
  recipients: StaffRecipient[];
  title: string;
  type: string;
  inAppMessage: string;
  buildWhatsApp: (recipient: StaffRecipient) => string;
}): Promise<void> {
  const { bookingId, recipients, title, type, inAppMessage, buildWhatsApp } = opts;
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

    try {
      const result = await sendWhatsAppText(recipient.mobileNumber, buildWhatsApp(recipient));
      if (result?.success) {
        console.log('[Notifications] Staff WhatsApp sent:', {
          bookingId,
          userId: recipient.userId,
          role: recipient.roleKey,
          messageId: result.messageId,
        });
      } else if (result?.outsideWindow) {
        // Expected when the staff member hasn't messaged the business in
        // the last 24h — not an error, just logged for the audit trail.
        console.log('[Notifications] Staff WhatsApp outside 24h window:', {
          bookingId,
          userId: recipient.userId,
          role: recipient.roleKey,
        });
      } else {
        console.warn('[Notifications] Staff WhatsApp send failed:', {
          bookingId,
          userId: recipient.userId,
          role: recipient.roleKey,
          error: result?.error || 'unknown',
        });
      }
    } catch (err) {
      console.error('[Notifications] Staff WhatsApp threw:', {
        bookingId,
        userId: recipient.userId,
        role: recipient.roleKey,
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

    const recipients = collectStaffRecipients(bookings);
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
    const assignmentLines = buildAssignmentLines(primary);

    const inAppMessage = [
      `New ${bookingType} booking`,
      `Customer: ${primary.playerName}`,
      `${dateStr}, ${timeStr}${slotSuffix}`,
      `Facility: ${facility}`,
    ].join(' | ');

    const buildWhatsApp = (recipient: StaffRecipient): string => {
      const lines = [
        `🏏 *New Booking* — ${centerName}`,
        `Hi ${recipient.name} (${STAFF_ROLE_LABELS[recipient.roleKey]}),`,
        `A new booking has been assigned to you.`,
        ``,
        `👤 Customer: ${primary.playerName}`,
        `📅 Date: ${dateStr}`,
        `⏰ Time: ${timeStr}${slotSuffix}`,
        `⏳ Duration: ${durationStr}`,
        `📍 Facility: ${facility}`,
        `🎯 Type: ${bookingType}`,
        ...assignmentLines,
      ];
      return lines.join('\n');
    };

    await dispatchStaffNotifications({
      bookingId: primary.id,
      recipients,
      title: 'New Booking Assigned',
      type: 'SUCCESS',
      inAppMessage,
      buildWhatsApp,
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

    const recipients = collectStaffRecipients([booking]);
    if (recipients.length === 0) return;

    const dateStr = formatIST(new Date(booking.date), 'EEE, dd MMM yyyy');
    const timeStr = `${formatIST(booking.startTime, 'hh:mm a')} – ${formatIST(booking.endTime, 'hh:mm a')}`;
    const facility = resolveFacility(booking);
    const bookingType = CATEGORY_LABELS[booking.category];
    const centerName = booking.center?.name || 'PlayOrbit';
    const cancelledBy = details.cancelledBy || booking.cancelledBy || 'Center';
    const reason = details.reason || booking.cancellationReason || undefined;

    const inAppMessage = [
      `${bookingType} booking CANCELLED`,
      `Customer: ${booking.playerName}`,
      `${dateStr}, ${timeStr}`,
      `Facility: ${facility}`,
      `Cancelled by: ${cancelledBy}`,
    ].join(' | ');

    const buildWhatsApp = (recipient: StaffRecipient): string => {
      const lines = [
        `❌ *Booking Cancelled* — ${centerName}`,
        `Hi ${recipient.name} (${STAFF_ROLE_LABELS[recipient.roleKey]}),`,
        `A booking assigned to you has been cancelled.`,
        ``,
        `👤 Customer: ${booking.playerName}`,
        `📅 Date: ${dateStr}`,
        `⏰ Time: ${timeStr}`,
        `📍 Facility: ${facility}`,
        `🎯 Type: ${bookingType}`,
        `🚫 Status: Cancelled`,
        `🙍 Cancelled by: ${cancelledBy}`,
      ];
      if (reason) lines.push(`📝 Reason: ${reason}`);
      return lines.join('\n');
    };

    await dispatchStaffNotifications({
      bookingId: booking.id,
      recipients,
      title: 'Booking Cancelled',
      type: 'CANCELLATION',
      inAppMessage,
      buildWhatsApp,
    });
  } catch (err) {
    console.error('[Notifications] notifyAssignedStaffBookingCancelled failed:', err);
  }
}
