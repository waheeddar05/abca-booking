/**
 * Multi-provider SMS OTP delivery.
 *
 * Provider priority:
 *   1. 2Factor.in  — if TWOFACTOR_API_KEY is set (best for Indian OTP, handles DLT)
 *   2. Fast2SMS    — if FAST2SMS_API_KEY is set (tries route=otp then route=q)
 *
 * @param mobileNumber - 10-digit Indian mobile number
 * @param otp          - The numeric OTP code (e.g. "482913")
 */
export async function sendSMS(
  mobileNumber: string,
  otp: string,
): Promise<{ success: boolean; error?: string; provider?: string; data?: unknown }> {
  // Try 2Factor.in first (purpose-built for Indian OTP, handles DLT)
  const twoFactorKey = process.env.TWOFACTOR_API_KEY;
  if (twoFactorKey) {
    const result = await sendViaTwoFactor(mobileNumber, otp, twoFactorKey);
    if (result.success) return result;
    console.warn('[SMS] 2Factor.in failed, trying Fast2SMS fallback:', result.error);
  }

  // Fallback to Fast2SMS
  const fast2smsKey = process.env.FAST2SMS_API_KEY;
  if (fast2smsKey) {
    return sendViaFast2SMS(mobileNumber, otp, fast2smsKey);
  }

  console.warn('[SMS] No SMS provider configured. Set TWOFACTOR_API_KEY or FAST2SMS_API_KEY.');
  return { success: false, error: 'No SMS provider configured' };
}

/**
 * Send OTP via 2Factor.in
 *
 * API: POST https://2factor.in/API/V1/{api_key}/SMS/{phone_number}/{otp}
 * Docs: https://2factor.in/API/DOCS/SMS_OTP.html
 *
 * - Handles DLT registration on your behalf
 * - ₹0.25/SMS, 1-3 second delivery
 * - Phone format: 10 digits (no country code prefix needed)
 */
async function sendViaTwoFactor(
  mobileNumber: string,
  otp: string,
  apiKey: string,
): Promise<{ success: boolean; error?: string; provider?: string; data?: unknown }> {
  try {
    // 2Factor expects 10-digit number without country code
    const digits = mobileNumber.replace(/\D/g, '');
    const phone = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;

    const url = `https://2factor.in/API/V1/${encodeURIComponent(apiKey)}/SMS/${encodeURIComponent(phone)}/${encodeURIComponent(otp)}`;

    console.log('[2Factor] Sending OTP to:', phone.slice(0, 4) + '****' + phone.slice(-2));

    const resp = await fetch(url, { method: 'GET' });
    const data = await resp.json();

    // 2Factor returns { Status: "Success", Details: "session_id" } on success
    if (data.Status === 'Success') {
      console.log('[2Factor] OTP sent successfully:', {
        sessionId: data.Details,
        phone: phone.slice(0, 4) + '****' + phone.slice(-2),
      });
      return { success: true, provider: '2factor', data };
    }

    console.error('[2Factor] OTP failed:', data.Status, data.Details);
    return { success: false, provider: '2factor', error: data.Details || 'Failed to send OTP' };
  } catch (error) {
    console.error('[2Factor] Error:', error instanceof Error ? error.message : error);
    return { success: false, provider: '2factor', error: 'Internal error' };
  }
}

/**
 * Send OTP via Fast2SMS.
 *
 * Tries `route=otp` first (₹0.15/SMS, needs website verification).
 * Falls back to `route=q` (Quick SMS, ₹5/SMS, needs ₹100+ wallet history).
 */
async function sendViaFast2SMS(
  mobileNumber: string,
  otp: string,
  apiKey: string,
): Promise<{ success: boolean; error?: string; provider?: string; data?: unknown }> {
  try {
    const otpUrl = `https://www.fast2sms.com/dev/bulkV2?authorization=${encodeURIComponent(apiKey)}&route=otp&variables_values=${encodeURIComponent(otp)}&flash=0&numbers=${encodeURIComponent(mobileNumber)}`;
    const otpResp = await fetch(otpUrl);
    const otpData = await otpResp.json();

    if (otpData.return) {
      console.log('[Fast2SMS] OTP route succeeded:', { requestId: otpData.request_id });
      return { success: true, provider: 'fast2sms', data: otpData };
    }

    console.warn('[Fast2SMS] OTP route failed:', otpData.status_code, otpData.message);

    // If OTP route is blocked (996 = website verification needed), try Quick SMS
    if (otpData.status_code === 996 || otpData.status_code === 411) {
      const message = `Your PlayOrbit verification code is ${otp}. Valid for 10 minutes. Do not share this code.`;
      const quickUrl = `https://www.fast2sms.com/dev/bulkV2?authorization=${encodeURIComponent(apiKey)}&route=q&message=${encodeURIComponent(message)}&flash=0&numbers=${encodeURIComponent(mobileNumber)}`;
      const quickResp = await fetch(quickUrl);
      const quickData = await quickResp.json();

      if (quickData.return) {
        console.log('[Fast2SMS] Quick SMS route succeeded:', { requestId: quickData.request_id });
        return { success: true, provider: 'fast2sms', data: quickData };
      }

      console.error('[Fast2SMS] Quick SMS route also failed:', quickData.status_code, quickData.message);
      return {
        success: false,
        provider: 'fast2sms',
        error: quickData.message || 'Both OTP and Quick SMS routes failed',
      };
    }

    return { success: false, provider: 'fast2sms', error: otpData.message || 'Failed to send SMS' };
  } catch (error) {
    console.error('[Fast2SMS] SMS sending failed:', error);
    return { success: false, provider: 'fast2sms', error: 'Internal error' };
  }
}
