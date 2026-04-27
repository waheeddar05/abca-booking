import Razorpay from 'razorpay';
import crypto from 'crypto';
import { prisma } from './prisma';

/**
 * Razorpay integration — per-center accounts (phase 6).
 *
 * Each `Center` row may store its own `razorpayKeyId`, `razorpayKeySecret`
 * and `razorpayWebhookSecret`. When a center has those configured, every
 * order/refund/signature operation for that center routes to its own
 * Razorpay account. Centers without configured keys fall back to the
 * platform-wide env vars (`RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` /
 * `RAZORPAY_WEBHOOK_SECRET`) — preserving the original single-center
 * behaviour for ABCA until it's flipped over.
 *
 * The instance cache is keyed by `centerId` so we don't re-construct
 * SDK clients per request. The env-fallback client is cached under
 * the special key `__env__`.
 */

interface CenterCredentials {
  centerId: string;
  centerName: string;
  keyId: string;
  keySecret: string;
  webhookSecret: string | null;
  /** True if these came from the env fallback (no per-center keys set). */
  fromEnvFallback: boolean;
}

const ENV_FALLBACK_KEY = '__env__';
const instanceCache = new Map<string, Razorpay>();

function envCredentials(centerId: string, centerName: string): CenterCredentials | null {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) return null;
  return {
    centerId,
    centerName,
    keyId,
    keySecret,
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || null,
    fromEnvFallback: true,
  };
}

/**
 * Resolve the credentials to use for the given center.
 * Returns null if neither the center nor env has both keyId and secret.
 */
export async function getCenterRazorpayCredentials(
  centerId: string,
): Promise<CenterCredentials | null> {
  const center = await prisma.center.findUnique({
    where: { id: centerId },
    select: {
      id: true,
      name: true,
      razorpayKeyId: true,
      razorpayKeySecret: true,
      razorpayWebhookSecret: true,
    },
  });
  if (!center) return null;

  if (center.razorpayKeyId && center.razorpayKeySecret) {
    return {
      centerId: center.id,
      centerName: center.name,
      keyId: center.razorpayKeyId,
      keySecret: center.razorpayKeySecret,
      webhookSecret: center.razorpayWebhookSecret || null,
      fromEnvFallback: false,
    };
  }

  return envCredentials(center.id, center.name);
}

/**
 * Get a cached Razorpay SDK client for the given center.
 * Throws if neither center nor env has credentials.
 */
export async function getRazorpayInstanceForCenter(centerId: string): Promise<Razorpay> {
  const creds = await getCenterRazorpayCredentials(centerId);
  if (!creds) {
    throw new Error(
      `Razorpay credentials not configured for center ${centerId} and no RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET env fallback set.`,
    );
  }
  const cacheKey = creds.fromEnvFallback ? ENV_FALLBACK_KEY : creds.centerId;
  let instance = instanceCache.get(cacheKey);
  if (!instance) {
    instance = new Razorpay({ key_id: creds.keyId, key_secret: creds.keySecret });
    instanceCache.set(cacheKey, instance);
  }
  return instance;
}

/**
 * Legacy singleton — kept for any caller that hasn't been migrated to
 * the per-center API yet. Reads only env vars. New code should call
 * `getRazorpayInstanceForCenter(centerId)` instead.
 *
 * @deprecated Use `getRazorpayInstanceForCenter(centerId)`.
 */
export function getRazorpayInstance(): Razorpay {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    throw new Error('Razorpay credentials not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env');
  }

  let instance = instanceCache.get(ENV_FALLBACK_KEY);
  if (!instance) {
    instance = new Razorpay({ key_id: keyId, key_secret: keySecret });
    instanceCache.set(ENV_FALLBACK_KEY, instance);
  }
  return instance;
}

// ─── Feature flags (unchanged) ──────────────────────────────────────

/**
 * Check if payment gateway is enabled via admin Policy table.
 * Default: disabled (so existing behavior is preserved until admin enables it).
 */
export async function isPaymentEnabled(): Promise<boolean> {
  try {
    const policy = await prisma.policy.findUnique({
      where: { key: 'PAYMENT_GATEWAY_ENABLED' },
    });
    return policy?.value === 'true';
  } catch {
    return false;
  }
}

/**
 * Check if payment is required for slot bookings.
 * When false, bookings can proceed without payment (walk-in / cash mode).
 */
export async function isSlotPaymentRequired(): Promise<boolean> {
  try {
    const policy = await prisma.policy.findUnique({
      where: { key: 'SLOT_PAYMENT_REQUIRED' },
    });
    return policy?.value === 'true';
  } catch {
    return false;
  }
}

/**
 * Check if payment is required for package purchases.
 */
export async function isPackagePaymentRequired(): Promise<boolean> {
  try {
    const policy = await prisma.policy.findUnique({
      where: { key: 'PACKAGE_PAYMENT_REQUIRED' },
    });
    return policy?.value === 'true';
  } catch {
    return false;
  }
}

// ─── Order / signature / refund — per-center ────────────────────────

/**
 * Create a Razorpay order using the center's Razorpay account.
 *
 * @param params.centerId  Center the order belongs to (required).
 * @param params.amount    Amount in rupees.
 */
export async function createRazorpayOrder(params: {
  centerId: string;
  amount: number;
  currency?: string;
  receipt: string;
  notes?: Record<string, string>;
}) {
  const razorpay = await getRazorpayInstanceForCenter(params.centerId);
  const amountInPaise = Math.round(params.amount * 100);

  // Always include centerId in notes so the webhook handler can route
  // even if the local Payment row hasn't been written yet.
  const notes = { ...(params.notes || {}), centerId: params.centerId };

  const order = await razorpay.orders.create({
    amount: amountInPaise,
    currency: params.currency || 'INR',
    receipt: params.receipt,
    notes,
  });

  return order;
}

/**
 * Verify Razorpay payment signature using the center's keySecret.
 *
 * Note: this is sync — the `centerId` caller is expected to look up the
 * Payment row first (which already carries `centerId`) and pass the
 * resolved secret in via `centerKeySecret`. This avoids an extra DB
 * round-trip when the caller already has the secret in hand.
 */
export function verifyPaymentSignatureWithSecret(params: {
  orderId: string;
  paymentId: string;
  signature: string;
  keySecret: string;
}): boolean {
  const body = `${params.orderId}|${params.paymentId}`;
  const expectedSignature = crypto
    .createHmac('sha256', params.keySecret)
    .update(body)
    .digest('hex');

  return expectedSignature === params.signature;
}

/**
 * Verify a payment signature for a center, looking up the credentials
 * automatically.
 */
export async function verifyPaymentSignatureForCenter(params: {
  centerId: string;
  orderId: string;
  paymentId: string;
  signature: string;
}): Promise<boolean> {
  const creds = await getCenterRazorpayCredentials(params.centerId);
  if (!creds) return false;
  return verifyPaymentSignatureWithSecret({
    orderId: params.orderId,
    paymentId: params.paymentId,
    signature: params.signature,
    keySecret: creds.keySecret,
  });
}

/**
 * Verify a webhook signature with a specific webhook secret.
 * Razorpay's webhook signature scheme:
 *   HMAC-SHA256(body, webhookSecret) === X-Razorpay-Signature
 */
export function verifyWebhookSignatureWithSecret(params: {
  body: string;
  signature: string;
  webhookSecret: string;
}): boolean {
  const expected = crypto
    .createHmac('sha256', params.webhookSecret)
    .update(params.body)
    .digest('hex');
  return expected === params.signature;
}

/**
 * @deprecated Use `verifyPaymentSignatureForCenter` or
 * `verifyPaymentSignatureWithSecret`. Kept for any caller still on the
 * env-only path.
 */
export function verifyPaymentSignature(params: {
  orderId: string;
  paymentId: string;
  signature: string;
}): boolean {
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) throw new Error('RAZORPAY_KEY_SECRET not configured');
  return verifyPaymentSignatureWithSecret({ ...params, keySecret });
}

/**
 * Initiate a refund on Razorpay using the center's account.
 */
export async function initiateRefund(params: {
  centerId: string;
  paymentId: string;
  amount?: number; // in rupees, omit for full refund
  notes?: Record<string, string>;
}) {
  const razorpay = await getRazorpayInstanceForCenter(params.centerId);
  const refundParams: Record<string, unknown> = {};

  if (params.amount) {
    refundParams.amount = Math.round(params.amount * 100); // Convert to paise
  }
  if (params.notes) {
    refundParams.notes = params.notes;
  }

  const refund = await razorpay.payments.refund(params.paymentId, refundParams);
  return refund;
}

/**
 * Fetch payment details from Razorpay using the center's account.
 */
export async function fetchPaymentDetails(centerId: string, paymentId: string) {
  const razorpay = await getRazorpayInstanceForCenter(centerId);
  return razorpay.payments.fetch(paymentId);
}
