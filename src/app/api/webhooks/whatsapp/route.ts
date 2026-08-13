import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  markWhatsAppUndeliverable,
  clearWhatsAppUndeliverable,
  markWhatsAppAccountBlocked,
  clearWhatsAppAccountBlocked,
  classifyFailedStatus,
} from '@/lib/whatsapp-deliverability';

const VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'playorbit-webhook-verify-2024';

/**
 * GET /api/webhooks/whatsapp
 * Webhook verification (Meta sends a GET to verify the endpoint).
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const mode = params.get('hub.mode');
  const token = params.get('hub.verify_token');
  const challenge = params.get('hub.challenge');

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[WhatsApp Webhook] Verified successfully');
    return new Response(challenge, { status: 200 });
  }

  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

/**
 * POST /api/webhooks/whatsapp
 * Receives incoming messages and delivery status updates.
 *
 * When a user sends any message to the business number, we check if
 * there's a pending OTP for that mobile number and auto-send it.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Always return 200 quickly to acknowledge receipt
    const entries = body?.entry || [];

    for (const entry of entries) {
      const changes = entry?.changes || [];

      for (const change of changes) {
        if (change?.field !== 'messages') continue;
        const value = change?.value;
        if (!value) continue;

        // Handle incoming messages
        const messages = value?.messages || [];
        for (const msg of messages) {
          const from = msg?.from; // e.g. "919860106704"
          if (!from) continue;

          console.log(`[WhatsApp Webhook] Incoming message from ${from}: ${msg?.text?.body || msg?.type}`);

          // Normalize: extract 10-digit Indian mobile
          const digits = from.replace(/\D/g, '');
          const cleaned = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;

          // Check if there's a user with a pending (unused, non-expired) OTP
          // who is trying to verify this mobile number
          const pendingUser = await prisma.user.findFirst({
            where: {
              OR: [
                { mobileNumber: cleaned },
                // Also check users who don't have a mobile yet but have pending OTPs
              ],
            },
            include: {
              otps: {
                where: {
                  used: false,
                  expiresAt: { gt: new Date() },
                },
                orderBy: { createdAt: 'desc' },
                take: 1,
              },
            },
          });

          // Record this as a "conversation opened" event
          // Store in a simple key-value or cache for tracking conversation windows
          await recordConversationWindow(cleaned);

          // They messaged us — the number is clearly reachable on WhatsApp.
          await clearWhatsAppUndeliverable(cleaned);

          // If there's a pending OTP that hasn't been sent yet (was queued),
          // we could re-send it now. But the current flow already sends it.
          // This webhook mainly ensures we know the conversation window is open.
        }

        // Handle status updates (sent, delivered, read, failed)
        const statuses = value?.statuses || [];
        for (const status of statuses) {
          if (status?.status === 'failed') {
            // Re-engagement (131047 / 470) = free-form text sent outside
            // the 24h customer-service window. Expected for booking and
            // operator notifications when the recipient hasn't messaged
            // us recently — not a bug, so it stays a single-line warning
            // and Vercel logs stay clean. The proper fix is a
            // pre-approved template (lib/whatsapp.ts); until every
            // notification is templated this will keep firing.
            //
            // Only a genuine "not on WhatsApp" code may raise the
            // undeliverable flag — see classifyFailedStatus.
            const { codes, isReEngagement, unreachableCode, accountBlockedCode } =
              classifyFailedStatus(status?.errors);

            if (isReEngagement) {
              console.warn(
                `[WhatsApp Webhook] Skipped: ${status?.recipient_id} outside 24h window (${codes.join(',') || '131047'})`,
              );
            } else {
              console.error(
                `[WhatsApp Webhook] Delivery failed for ${status?.recipient_id}:`,
                JSON.stringify(status?.errors ?? []),
              );
            }

            if (unreachableCode !== undefined && status?.recipient_id) {
              await markWhatsAppUndeliverable(status.recipient_id, unreachableCode);
            }

            // Account-level refusal (unpaid WABA billing, locked account,
            // policy block). Nothing is reaching anyone until it's fixed,
            // and it is NOT the recipient's number — record it once so
            // the OTP flow can say something true.
            if (accountBlockedCode !== undefined) {
              await markWhatsAppAccountBlocked(accountBlockedCode);
            }
          } else if (status?.status === 'read' || status?.status === 'delivered') {
            // Message reached the device — clear any stale undeliverable flag.
            if (status?.recipient_id) {
              await clearWhatsAppUndeliverable(status.recipient_id);
            }
            // Delivery is demonstrably working, so the account isn't blocked.
            await clearWhatsAppAccountBlocked();
            // Successful delivery events are noisy — only log on debug
            // when explicitly requested. Default: silent.
            if (process.env.WHATSAPP_LOG_DELIVERY === 'true') {
              console.log(
                `[WhatsApp Webhook] ${status.status}: ${status?.id} → ${status?.recipient_id}`,
              );
            }
          }
        }
      }
    }

    return NextResponse.json({ status: 'ok' }, { status: 200 });
  } catch (error) {
    console.error('[WhatsApp Webhook] Error:', error);
    // Always return 200 to prevent Meta from retrying
    return NextResponse.json({ status: 'ok' }, { status: 200 });
  }
}

/**
 * Record that a user has sent a message, opening a 24h conversation window.
 * Uses the Policy table as a simple key-value store.
 */
async function recordConversationWindow(mobile10: string) {
  const key = `WA_CONV_${mobile10}`;
  const expiresAt = new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString(); // 23h from now (safety margin)

  try {
    await prisma.policy.upsert({
      where: { key },
      update: { value: expiresAt },
      create: { key, value: expiresAt },
    });
    console.log(`[WhatsApp] Conversation window recorded for ${mobile10} until ${expiresAt}`);
  } catch (err) {
    // Non-critical — log and continue
    console.warn('[WhatsApp] Failed to record conversation window:', err);
  }
}
