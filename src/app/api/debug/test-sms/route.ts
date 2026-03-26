import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth';

/**
 * GET /api/debug/test-sms?number=XXXXXXXXXX
 *
 * Diagnostic endpoint to test Fast2SMS directly.
 * Requires ADMIN role. Remove after debugging.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    }

    const number = req.nextUrl.searchParams.get('number');
    if (!number) {
      return NextResponse.json({ error: 'number param required' }, { status: 400 });
    }

    const apiKey = process.env.FAST2SMS_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'FAST2SMS_API_KEY not set', hasKey: false }, { status: 500 });
    }

    const testOtp = '999999';
    const url = `https://www.fast2sms.com/dev/bulkV2?authorization=${apiKey}&route=otp&variables_values=${testOtp}&numbers=${number}`;

    console.log('[test-sms] Calling Fast2SMS:', {
      number,
      keyPrefix: apiKey.slice(0, 8) + '...',
      url: url.replace(apiKey, 'REDACTED'),
    });

    const response = await fetch(url);
    const statusCode = response.status;
    const responseText = await response.text();

    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      data = { raw: responseText };
    }

    console.log('[test-sms] Fast2SMS response:', { statusCode, data });

    return NextResponse.json({
      fast2sms: {
        statusCode,
        response: data,
        apiKeySet: true,
        apiKeyPrefix: apiKey.slice(0, 8) + '...',
      },
    });
  } catch (error) {
    console.error('[test-sms] Error:', error);
    return NextResponse.json({
      error: 'Internal error',
      details: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
