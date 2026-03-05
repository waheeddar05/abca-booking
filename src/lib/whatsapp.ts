/**
 * WhatsApp BSP Provider — BSP-agnostic service for sending WhatsApp messages.
 *
 * Currently supports the Meta Cloud API (WhatsApp Business Platform).
 * To switch BSPs (Gupshup, Twilio, ValueFirst, etc.) implement the
 * `WhatsAppProvider` interface and swap in `getProvider()`.
 *
 * Environment variables:
 *   WHATSAPP_PHONE_NUMBER_ID  – Meta Cloud API phone number ID
 *   WHATSAPP_ACCESS_TOKEN     – Bearer token for the Cloud API
 *   WHATSAPP_API_URL          – (optional) override for the Graph API base URL
 *   WHATSAPP_OTP_TEMPLATE     – (optional) template name for OTP messages (default: "otp_login")
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

function isConfigured(): boolean {
  return !!(process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN);
}

const OTP_TEMPLATE_NAME = process.env.WHATSAPP_OTP_TEMPLATE || 'otp_login';
const TEMPLATE_LANGUAGE = 'en';

// ─── Meta Cloud API Provider ────────────────────────────────────────

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
      const res = await fetch(`${this.baseUrl}/messages`, {
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
        console.error('WhatsApp API error:', JSON.stringify(data));
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
      console.error('WhatsApp sendTemplate error:', message);
      return { success: false, error: message };
    }
  }

  async sendText(to: string, body: string): Promise<WhatsAppSendResult> {
    try {
      const res = await fetch(`${this.baseUrl}/messages`, {
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
        console.error('WhatsApp API error:', JSON.stringify(data));
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
      console.error('WhatsApp sendText error:', message);
      return { success: false, error: message };
    }
  }
}

// ─── Provider singleton ─────────────────────────────────────────────

let _provider: WhatsAppProvider | null = null;

function getProvider(): WhatsAppProvider | null {
  if (!isConfigured()) return null;
  if (!_provider) _provider = new MetaCloudAPIProvider();
  return _provider;
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
  // 10 digits or 12 with 91 prefix
  const cleaned = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  return /^[6-9]\d{9}$/.test(cleaned);
}

/**
 * Send OTP via WhatsApp.
 *
 * Strategy (in order):
 *   1. If a named template is configured and not "text", use it (works for verified businesses).
 *   2. If template is "text" or sending fails, fall back to plain text (requires 24h window).
 *   3. If WhatsApp is not configured, log a warning and fake success (dev mode).
 */
export async function sendWhatsAppOTP(
  mobileNumber: string,
  otp: string,
): Promise<WhatsAppSendResult> {
  const provider = getProvider();
  if (!provider) {
    console.warn('[WhatsApp] Not configured — OTP would be:', otp, 'to', mobileNumber);
    // In dev/unconfigured mode, we still return success so the flow doesn't break
    return { success: true, messageId: `dev-${Date.now()}` };
  }

  const to = formatIndianMobile(mobileNumber);
  const ttl = process.env.OTP_TTL_MINUTES || '5';
  const textBody = `Your PlayOrbit verification code is: ${otp}. It expires in ${ttl} minutes. Do not share this code.`;

  // Try template first if one is configured (not "text" mode)
  if (OTP_TEMPLATE_NAME !== 'text') {
    const templateResult = await provider.sendTemplate(to, OTP_TEMPLATE_NAME, TEMPLATE_LANGUAGE, [
      {
        type: 'body',
        parameters: [{ type: 'text', text: otp }],
      },
    ]);

    if (templateResult.success) return templateResult;

    // Template failed — fall through to text
    console.warn('[WhatsApp] Template send failed, falling back to text:', templateResult.error);
  }

  // Plain text fallback (requires user to have messaged the business first)
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
