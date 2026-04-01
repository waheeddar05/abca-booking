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
  type TemplateComponent,
  type WhatsAppSendResult,
} from '@/lib/whatsapp';
import type { NotificationChannel, WhatsAppMessageStatus } from '@prisma/client';

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
  },
): Promise<SendResult> {
  // Template booking_detail (7 params):
  // "🏏 *Booking Confirmed!*\n📅 {{1}}\n⏰ {{2}}\n🎯 {{3}} — {{4}}\n💰 {{5}}\n👤 Operator: {{6}}\n📞 Contact: {{7}}\n📍 PlayOrbit Cricket Nets + maps link"
  const slotSummary = `${details.machine}, ${details.pitch} — ${details.time} on ${details.date} (${details.price})`;
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
                { type: 'text', text: details.price },
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
      type: 'WARNING',
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
