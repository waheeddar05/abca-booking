/**
 * WhatsApp BSP Provider — BSP-agnostic service for sending WhatsApp messages.
 *
 * Supports two providers (selected automatically based on env vars):
 *   1. Twilio WhatsApp API (recommended — simple setup, reliable delivery)
 *   2. Meta Cloud API (legacy fallback)
 *
 * Twilio env vars:
 *   TWILIO_ACCOUNT_SID      – Twilio Account SID
 *   TWILIO_AUTH_TOKEN        – Twilio Auth Token
 *   TWILIO_WHATSAPP_FROM     – Twilio WhatsApp sender (e.g. "whatsapp:+14155238886")
 *
 * Meta env vars (legacy):
 *   WHATSAPP_PHONE_NUMBER_ID – Meta Cloud API phone number ID
 *   WHATSAPP_ACCESS_TOKEN    – Bearer token for the Cloud API
 *   WHATSAPP_API_URL         – (optional) override for the Graph API base URL
 *   WHATSAPP_OTP_TEMPLATE    – (optional) template name (default: "otp_login")
 */

// ─── Types ──────────────────────────────────────────────────────────

export interface WhatsAppSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface WhatsAppProvider {
  sendTemplate(
    to: string,
    templateName: string,
    language: string,
    components: TemplateComponent[],
  ): Promise<WhatsAppSendResult>;

  sendText(to: string, body: string): Promise<WhatsAppSendResult>;
}

export interface TemplateComponent {
  type: 'body' | 'header' | 'button';
  parameters: { type: string; text?: string }[];
  sub_type?: string;
  index?: string;
}

// ─── Configuration ──────────────────────────────────────────────────

type ProviderType = 'twilio' | 'meta' | null;

function detectProvider(): ProviderType {
  if (
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_WHATSAPP_FROM
  ) {
    return 'twilio';
  }
  if (process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN) {
    return 'meta';
  }
  return null;
}

const OTP_TEMPLATE_NAME = process.env.WHATSAPP_OTP_TEMPLATE || 'otp_login';
const TEMPLATE_LANGUAGE = 'en';

// ─── Twilio WhatsApp Provider ───────────────────────────────────────

class TwilioWhatsAppProvider implements WhatsAppProvider {
  private accountSid: string;
  private authToken: string;
  private from: string;

  constructor() {
    this.accountSid = process.env.TWILIO_ACCOUNT_SID || '';
    this.authToken = process.env.TWILIO_AUTH_TOKEN || '';
    this.from = process.env.TWILIO_WHATSAPP_FROM || '';
  }

  /**
   * Twilio doesn't have a separate "template" API — for WhatsApp,
   * pre-approved content templates are sent as regular messages.
   * Twilio handles the template matching automatically when the
   * message body matches an approved template.
   *
   * For OTP, we just send a plain text message containing the code.
   */
  async sendTemplate(
    to: string,
    _templateName: string,
    _language: string,
    components: TemplateComponent[],
  ): Promise<WhatsAppSendResult> {
    // Extract the OTP from template components
    const otp = components?.[0]?.parameters?.[0]?.text || '';
    const ttl = process.env.OTP_TTL_MINUTES || '5';
    const body = `Your PlayOrbit verification code is: ${otp}. It expires in ${ttl} minutes. Do not share this code.`;
    return this.sendText(to, body);
  }

  async sendText(to: string, body: string): Promise<WhatsAppSendResult> {
    try {
      const whatsappTo = `whatsapp:+${to}`;
      const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;

      console.log('[WhatsApp/Twilio] Sending message to:', to);

      const credentials = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');

      const params = new URLSearchParams({
        From: this.from,
        To: whatsappTo,
        Body: body,
      });

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      const data = await res.json();

      if (!res.ok) {
        console.error('[WhatsApp/Twilio] API error:', {
          status: res.status,
          code: data?.code,
          message: data?.message,
          moreInfo: data?.more_info,
          to,
        });
        return {
          success: false,
          error: data?.message || `HTTP ${res.status}`,
        };
      }

      console.log('[WhatsApp/Twilio] Message sent:', {
        sid: data?.sid,
        status: data?.status,
        to,
      });

      return {
        success: true,
        messageId: data?.sid,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[WhatsApp/Twilio] sendText error:', message);
      return { success: false, error: message };
    }
  }
}

// ─── Meta Cloud API Provider (legacy) ──────────────────────────────

class MetaCloudAPIProvider implements WhatsAppProvider {
  private phoneNumberId: string;
  private accessToken: string;
  private baseUrl: string;

  constructor() {
    this.phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
    this.accessToken = process.env.WHATSAPP_ACCESS_TOKEN || '';
    this.baseUrl =
      process.env.WHATSAPP_API_URL ||
      `https://graph.facebook.com/v21.0/${this.phoneNumberId}`;
  }

  async sendTemplate(
    to: string,
    templateName: string,
    language: string,
    components: TemplateComponent[],
  ): Promise<WhatsAppSendResult> {
    try {
      const url = `${this.baseUrl}/messages`;
      console.log('[WhatsApp/Meta] Sending template:', { url, to, templateName, language });

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: {
            name: templateName,
            language: { code: language },
            components,
          },
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        console.error('[WhatsApp/Meta] API error:', {
          status: res.status,
          error: data?.error,
          to,
          templateName,
        });
        return {
          success: false,
          error: data?.error?.message || `HTTP ${res.status}`,
        };
      }

      return {
        success: true,
        messageId: data?.messages?.[0]?.id,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[WhatsApp/Meta] sendTemplate error:', message);
      return { success: false, error: message };
    }
  }

  async sendText(to: string, body: string): Promise<WhatsAppSendResult> {
    try {
      const url = `${this.baseUrl}/messages`;
      console.log('[WhatsApp/Meta] Sending text to:', to);

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body },
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        console.error('[WhatsApp/Meta] API error (text):', {
          status: res.status,
          error: data?.error,
          to,
        });
        return {
          success: false,
          error: data?.error?.message || `HTTP ${res.status}`,
        };
      }

      return {
        success: true,
        messageId: data?.messages?.[0]?.id,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[WhatsApp/Meta] sendText error:', message);
      return { success: false, error: message };
    }
  }
}

// ─── Provider factory ───────────────────────────────────────────────

function getProvider(): WhatsAppProvider | null {
  const type = detectProvider();
  if (type === 'twilio') return new TwilioWhatsAppProvider();
  if (type === 'meta') return new MetaCloudAPIProvider();
  return null;
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Format an Indian mobile number to E.164 (91XXXXXXXXXX).
 * Accepts 10-digit, +91XXXXXXXXXX, or 91XXXXXXXXXX.
 */
export function formatIndianMobile(mobile: string): string {
  const digits = mobile.replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  return digits; // return as-is if already formatted
}

/**
 * Validate Indian mobile number (10 digits starting with 6-9).
 */
export function isValidIndianMobile(mobile: string): boolean {
  const digits = mobile.replace(/\D/g, '');
  const cleaned = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  return /^[6-9]\d{9}$/.test(cleaned);
}

/**
 * Send OTP via WhatsApp.
 *
 * Strategy:
 *   1. Twilio: sends as plain text (Twilio auto-matches templates).
 *   2. Meta: tries template first, falls back to text.
 *   3. If not configured: dev mode fakes success, prod returns error.
 */
export async function sendWhatsAppOTP(
  mobileNumber: string,
  otp: string,
): Promise<WhatsAppSendResult> {
  const provider = getProvider();
  if (!provider) {
    const isDev = process.env.NODE_ENV === 'development';
    if (isDev) {
      console.warn('[WhatsApp] Not configured (dev mode) — OTP:', otp, 'to', mobileNumber);
      return { success: true, messageId: `dev-${Date.now()}` };
    }
    console.error(
      '[WhatsApp] CRITICAL: Not configured in production. Set TWILIO_* or WHATSAPP_* env vars.',
      {
        hasTwilio: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
        hasMeta: !!(process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN),
      },
    );
    return { success: false, error: 'WhatsApp is not configured on the server' };
  }

  const providerType = detectProvider();
  const to = formatIndianMobile(mobileNumber);
  const ttl = process.env.OTP_TTL_MINUTES || '5';
  const textBody = `Your PlayOrbit verification code is: ${otp}. It expires in ${ttl} minutes. Do not share this code.`;

  // Twilio: just send text directly (no template API needed)
  if (providerType === 'twilio') {
    return provider.sendText(to, textBody);
  }

  // Meta: try template first, fall back to text
  if (OTP_TEMPLATE_NAME !== 'text') {
    const templateResult = await provider.sendTemplate(to, OTP_TEMPLATE_NAME, TEMPLATE_LANGUAGE, [
      {
        type: 'body',
        parameters: [{ type: 'text', text: otp }],
      },
    ]);

    if (templateResult.success) return templateResult;
    console.warn('[WhatsApp] Template send failed, falling back to text:', templateResult.error);
  }

  return provider.sendText(to, textBody);
}

/**
 * Send a general WhatsApp notification using a pre-approved template.
 * Returns null if WhatsApp is not configured (graceful skip).
 */
export async function sendWhatsAppNotification(
  mobileNumber: string,
  templateName: string,
  components: TemplateComponent[],
  language = TEMPLATE_LANGUAGE,
): Promise<WhatsAppSendResult | null> {
  const provider = getProvider();
  if (!provider) {
    console.warn('[WhatsApp] Not configured — skipping notification to', mobileNumber);
    return null;
  }

  const to = formatIndianMobile(mobileNumber);
  return provider.sendTemplate(to, templateName, language, components);
}

/**
 * Send a plain text WhatsApp message (for admin/operator use).
 */
export async function sendWhatsAppText(
  mobileNumber: string,
  text: string,
): Promise<WhatsAppSendResult | null> {
  const provider = getProvider();
  if (!provider) {
    console.warn('[WhatsApp] Not configured — skipping text to', mobileNumber);
    return null;
  }

  const to = formatIndianMobile(mobileNumber);
  return provider.sendText(to, text);
}
