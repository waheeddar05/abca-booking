import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth';
import { sendSMS } from '@/lib/sms';

/**
 * GET /api/debug/test-sms?number=XXXXXXXXXX
 *
 * Diagnostic endpoint to test SMS delivery via all configured providers.
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

    const testOtp = '999999';

    console.log('[test-sms] Testing SMS delivery to:', number, {
      has2FactorKey: !!process.env.TWOFACTOR_API_KEY,
      hasFast2SMSKey: !!process.env.FAST2SMS_API_KEY,
    });

    const result = await sendSMS(number, testOtp);

    console.log('[test-sms] Result:', result);

    return NextResponse.json({
      testNumber: number,
      testOtp,
      result,
      providers: {
        twofactor: process.env.TWOFACTOR_API_KEY ? 'configured' : 'not set',
        fast2sms: process.env.FAST2SMS_API_KEY ? 'configured' : 'not set',
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
